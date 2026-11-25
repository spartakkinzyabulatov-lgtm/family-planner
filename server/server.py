#!/usr/bin/env python3
"""Family planner API. Standard library only. No runtime data in the checkout."""
import argparse
import datetime as dt
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ITERATIONS = 300000
SESSION_SECONDS = 30 * 86400
CATEGORIES = ('Дом', 'Продукты', 'Здоровье', 'Семья', 'Подарки', 'Другое')
PUBLIC = {'index.html', 'style.css', 'app.js', 'model.mjs', 'vault.mjs', 'storage.mjs', 'config.js', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'}


def connect(database):
    db = sqlite3.connect(database, timeout=15)
    db.execute('PRAGMA journal_mode=WAL')
    return db


def initialize(database, pin=None):
    if pin is not None and (not isinstance(pin, str) or not 1 <= len(pin) <= 128):
        raise ValueError('PIN must contain 1–128 characters')
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    with connect(database) as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (ip TEXT PRIMARY KEY, count INTEGER, reset REAL);
        ''')
        if pin is not None:
            if db.execute("SELECT 1 FROM settings WHERE key='pin_hash'").fetchone():
                raise ValueError('PIN already configured; refusing to overwrite')
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac('sha256', pin.encode(), bytes.fromhex(salt), ITERATIONS).hex()
            db.executemany('INSERT INTO settings VALUES (?, ?)', [('pin_salt', salt), ('pin_hash', digest)])
    os.chmod(database, 0o600)


def validate_operation(op):
    if not isinstance(op, dict) or set(op) != {'opId', 'id', 'changes'}:
        raise ValueError('Неверный формат изменения')
    for key in ('opId', 'id'):
        if not isinstance(op[key], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', op[key]):
            raise ValueError('Неверный идентификатор')
    changes = op['changes']
    if not isinstance(changes, dict) or not changes or set(changes) - {'title', 'amount', 'date', 'month', 'category', 'note', 'done'}:
        raise ValueError('Неверные поля покупки')
    for field, value in changes.items():
        if isinstance(value, str):
            value.encode('utf-8', errors='strict')
        if field == 'title' and (not isinstance(value, str) or not value.strip() or len(value) > 200):
            raise ValueError('Укажите название до 200 символов')
        if field == 'amount' and value is not None and (type(value) is not int or not 0 <= value <= 100000000000):
            raise ValueError('Неверная сумма')
        if field == 'done' and type(value) is not bool:
            raise ValueError('Неверный статус')
        if field == 'category' and value not in CATEGORIES:
            raise ValueError('Неверная категория')
        if field == 'note' and (not isinstance(value, str) or len(value) > 1000):
            raise ValueError('Комментарий слишком длинный')
        if field == 'month' and value is not None and (not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', value) or value.startswith('0000')):
            raise ValueError('Неверный месяц')
        if field == 'date' and value is not None:
            if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('Неверная дата')
            dt.date.fromisoformat(value)
    return op


def make_server(host, port, database, origins, static_root=None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):
            pass  # No family records, authorization headers or IPs in access logs.

        def reply(self, status, data=None, content_type='application/json; charset=utf-8'):
            body = json.dumps(data, ensure_ascii=False).encode() if content_type.startswith('application/json') else data
            body = body or b''
            self.send_response(status)
            origin = self.headers.get('Origin')
            if origin in origins:
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            origin = self.headers.get('Origin')
            return not origin or origin in origins

        def do_OPTIONS(self):
            self.reply(204 if self.allowed() else 403)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/health':
                self.reply(200, {'ok': True, 'version': 1})
                return
            name = path.lstrip('/') or 'index.html'
            if static_root and name in PUBLIC:
                file = Path(static_root) / name
                if file.is_file():
                    mime = 'text/javascript' if file.suffix in ('.js', '.mjs') else mimetypes.guess_type(name)[0] or 'application/octet-stream'
                    self.reply(200, file.read_bytes(), mime)
                    return
            self.reply(404, {'error': 'Не найдено'})

        def do_POST(self):
            if not self.allowed():
                self.reply(403, {'error': 'Доступ запрещён'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 262144:
                    self.reply(413, {'error': 'Слишком большой запрос'})
                    return
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Неверный запрос')
                path = urlsplit(self.path).path
                with connect(database) as db:
                    db.execute('BEGIN IMMEDIATE')
                    if path == '/api/login':
                        status, result = self.login(db, body)
                    elif path in ('/api/sync', '/api/logout'):
                        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
                        digest = hashlib.sha256(token.encode()).hexdigest()
                        session = db.execute('SELECT expires FROM sessions WHERE digest=?', (digest,)).fetchone()
                        if not session or session[0] < time.time():
                            status, result = 401, {'error': 'Войдите снова для синхронизации'}
                        elif path == '/api/logout':
                            db.execute('DELETE FROM sessions WHERE digest=?', (digest,))
                            status, result = 200, {'ok': True}
                        else:
                            status, result = self.sync(db, body)
                    else:
                        status, result = 404, {'error': 'Не найдено'}
                self.reply(status, result)
            except (ValueError, TypeError, UnicodeError):
                self.reply(400, {'error': 'Проверьте название, сумму и дату покупки'})
            except (sqlite3.Error, OSError):
                self.reply(503, {'error': 'Сохранение временно недоступно. Изменения остаются на устройстве'})

        def login(self, db, body):
            pin = body.get('pin')
            if not isinstance(pin, str) or not 1 <= len(pin) <= 128:
                raise ValueError('Неверный PIN')
            ip = self.client_address[0]
            # Caddy is the only production caller; backend listens on loopback.
            if ip in ('127.0.0.1', '::1'):
                ip = self.headers.get('X-Forwarded-For', ip).split(',')[-1].strip()
            now = time.time()
            attempt = db.execute('SELECT count, reset FROM attempts WHERE ip=?', (ip,)).fetchone()
            count, reset = attempt if attempt and attempt[1] > now else (0, now + 900)
            if count >= 5:
                return 429, {'error': 'Слишком много попыток. Попробуйте через 15 минут'}
            settings = dict(db.execute('SELECT key, value FROM settings'))
            if 'pin_hash' not in settings:
                return 503, {'error': 'Общий доступ ещё не настроен'}
            digest = hashlib.pbkdf2_hmac('sha256', pin.encode(), bytes.fromhex(settings['pin_salt']), ITERATIONS).hex()
            if not hmac.compare_digest(digest, settings['pin_hash']):
                db.execute('INSERT OR REPLACE INTO attempts VALUES (?, ?, ?)', (ip, count + 1, reset))
                return 401, {'error': 'Неверный пароль'}
            db.execute('DELETE FROM attempts WHERE ip=?', (ip,))
            db.execute('DELETE FROM sessions WHERE expires < ?', (now,))
            token = secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES (?, ?)', (hashlib.sha256(token.encode()).hexdigest(), now + SESSION_SECONDS))
            return 200, {'token': token}

        def sync(self, db, body):
            operations = body.get('operations')
            if not isinstance(operations, list) or len(operations) > 200:
                raise ValueError('Неверный список изменений')
            for op in operations:
                validate_operation(op)
            acknowledged = []
            for op in operations:
                acknowledged.append(op['opId'])
                if db.execute('SELECT 1 FROM operations WHERE id=?', (op['opId'],)).fetchone():
                    continue
                row = db.execute('SELECT data FROM items WHERE id=?', (op['id'],)).fetchone()
                now = dt.datetime.now(dt.timezone.utc).isoformat()
                if not row and 'title' not in op['changes']:
                    raise ValueError('Покупка не найдена')
                item = json.loads(row[0]) if row else {'id': op['id'], 'title': '', 'amount': None, 'date': None, 'category': 'Другое', 'note': '', 'done': False, 'createdAt': now}
                item.update(op['changes'])
                item['updatedAt'] = now
                db.execute('INSERT OR REPLACE INTO items VALUES (?, ?)', (op['id'], json.dumps(item, ensure_ascii=False)))
                db.execute('INSERT INTO operations VALUES (?)', (op['opId'],))
            items = [json.loads(row[0]) for row in db.execute('SELECT data FROM items ORDER BY rowid')]
            revision = db.execute('SELECT COUNT(*) FROM operations').fetchone()[0]
            return 200, {'items': items, 'acknowledged': acknowledged, 'revision': revision}

    http = ThreadingHTTPServer((host, port), Handler)
    http.daemon_threads = True
    return http


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['serve', 'init-pin'])
    parser.add_argument('--database', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--origin', action='append', default=[])
    parser.add_argument('--static-root')
    args = parser.parse_args()
    if args.command == 'init-pin':
        pin = getpass.getpass('Общий PIN: ')
        if pin != getpass.getpass('Повторите PIN: '):
            raise SystemExit('PIN не совпал. Ничего не записано.')
        initialize(args.database, pin)
        print('PIN configured; plaintext was not stored.')
        return
    initialize(args.database)
    http = make_server(args.host, args.port, args.database, args.origin, args.static_root)
    print('Family planner listening on http://%s:%s' % (args.host, args.port), flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.server_close()


if __name__ == '__main__':
    main()
