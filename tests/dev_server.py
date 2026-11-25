"""Ephemeral local QA service. Never uses real family data or the real PIN."""
import importlib.util
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('family_server', root / 'server/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
with tempfile.TemporaryDirectory(prefix='family-planner-qa-') as directory:
    database = str(Path(directory) / 'test.sqlite')
    server.initialize(database, '000000')
    http = server.make_server('127.0.0.1', 8765, database, ['http://127.0.0.1:8765','http://localhost:8765'], root)
    print('QA only: http://127.0.0.1:8765 — disposable data', flush=True)
    http.serve_forever()
