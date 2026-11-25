import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('family_server', Path(__file__).parents[1] / 'server/server.py')
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.tmp.name) / 'data.sqlite')
        self.pin = os.urandom(8).hex()
        server.initialize(self.db, self.pin)
        self.http = server.make_server('127.0.0.1', 0, self.db, ['https://family.example'])
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:%d' % self.http.server_port
        self.token = self.request('/api/login', {'pin': self.pin})[1]['token']

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.tmp.cleanup()

    def request(self, path, body=None, token=None, origin='https://family.example'):
        headers = {'Origin': origin, 'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, json.loads(response.read())

    def sync(self, operations):
        return self.request('/api/sync', {'operations': operations}, self.token)

    def op(self, key, changes, item='item-1'):
        return {'opId': key, 'id': item, 'changes': changes}

    def test_requires_auth_and_rejects_bad_pin(self):
        self.assertEqual(self.request('/api/sync', {'operations': []})[0], 401)
        self.assertEqual(self.request('/api/login', {'pin': 'incorrect'})[0], 401)

    def test_merge_two_devices_and_retry(self):
        self.sync([self.op('one', {'title': 'Покупка', 'amount': 125050, 'date': '2026-12-12'})])
        self.sync([self.op('two', {'done': True})])
        status, result = self.sync([self.op('three', {'amount': 99000}), self.op('four', {'title': 'Другая'}, 'item-2')])
        self.assertEqual(status, 200)
        item = next(x for x in result['items'] if x['id'] == 'item-1')
        self.assertEqual((item['title'], item['amount'], item['done']), ('Покупка', 99000, True))
        self.sync([self.op('three', {'amount': 1})])
        self.assertEqual(self.sync([])[1]['items'][0]['amount'], 99000)
        self.assertEqual(len(result['items']), 2)

    def test_atomic_validation(self):
        status, _ = self.sync([self.op('one', {'title': 'Покупка'}), self.op('two', {'amount': -1}, 'item-2')])
        self.assertEqual(status, 400)
        self.assertEqual(self.sync([])[1]['items'], [])
        for changes in [{'title': ''}, {'date': '2026-02-30'}, {'done': 'yes'}, {'amount': True}, {'amount': 0.5}, {'secret': 'x'}, {'title': '\ud800'}, {'title': 'Покупка', 'month': '٢٠٢٦-12'}]:
            self.assertEqual(self.sync([self.op('invalid', changes)])[0], 400, changes)

    def test_zero_unknown_and_undated(self):
        self.sync([self.op('zero', {'title': 'Бесплатно', 'amount': 0}), self.op('unknown', {'title': 'Уточнить', 'amount': None, 'date': None}, 'item-2')])
        items = self.sync([])[1]['items']
        self.assertEqual(items[0]['amount'], 0)
        self.assertIsNone(items[1]['amount'])
        self.assertIsNone(items[1]['date'])

    def test_planning_month_without_exact_day(self):
        self.assertEqual(self.sync([self.op('month', {'title': 'Покупка', 'month': '2026-12'})])[0], 200)
        item = self.sync([])[1]['items'][0]
        self.assertEqual(item['month'], '2026-12')
        self.assertIsNone(item['date'])
        self.assertEqual(self.sync([self.op('wrong', {'month': '2026-13'})])[0], 400)

    def test_foreign_origin(self):
        self.assertEqual(self.request('/api/sync', {'operations': []}, self.token, 'https://foreign.example')[0], 403)

    def test_pin_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.request('/api/login', {'pin': 'bad'})[0], 401)
        self.assertEqual(self.request('/api/login', {'pin': self.pin})[0], 429)

    def test_database_reopen_keeps_records(self):
        self.sync([self.op('save', {'title': 'Сохранить'})])
        server.initialize(self.db)
        self.assertEqual(self.sync([])[1]['items'][0]['title'], 'Сохранить')

    def test_invalid_pin_never_initializes_database(self):
        for pin in ['', 'x' * 129]:
            target = str(Path(self.tmp.name) / ('invalid-%d.sqlite' % len(pin)))
            with self.assertRaises(ValueError):
                server.initialize(target, pin)

    def test_revision_grows_only_with_new_operations(self):
        before = self.sync([])[1]['revision']
        self.sync([self.op('revision', {'title': 'Покупка'})])
        after = self.sync([self.op('revision', {'title': 'Покупка'})])[1]['revision']
        self.assertEqual(after, before + 1)


if __name__ == '__main__':
    unittest.main()
