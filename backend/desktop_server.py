"""Authenticated localhost bridge between the Python backend and Qt desktop shell."""
import functools
import hmac
import http.server
import json
import queue
import secrets
import threading
import uuid


class DesktopServer:
    def __init__(self, api, directory):
        self.api = api
        self.token = secrets.token_urlsafe(32)
        self.events = queue.Queue()
        self.pending = {}
        self.lock = threading.Lock()
        self.methods = [name for name in dir(api) if not name.startswith('_') and callable(getattr(api, name))]
        owner = self

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def json_response(self, value, status=200):
                body = json.dumps(value).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def authorized(self):
                return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + owner.token)

            def do_GET(self):
                if self.path == '/events':
                    if not self.authorized():
                        self.json_response({'error': 'Unauthorized'}, 403)
                        return
                    items = []
                    while len(items) < 100:
                        try:
                            items.append(owner.events.get_nowait())
                        except queue.Empty:
                            break
                    self.json_response(items)
                else:
                    super().do_GET()

            def do_POST(self):
                if not self.authorized():
                    self.json_response({'error': 'Unauthorized'}, 403)
                    return
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 8 * 1024 * 1024:
                        raise ValueError('Invalid request length')
                    request = json.loads(self.rfile.read(length))
                    if self.path == '/ui-reply':
                        with owner.lock:
                            entry = owner.pending.get(request['id'])
                            if entry:
                                entry['result'] = request.get('result')
                                entry['event'].set()
                        self.json_response({'ok': True})
                        return
                    if self.path != '/rpc' or request.get('method') not in owner.methods:
                        self.json_response({'error': 'Unknown method'}, 404)
                        return
                    args = request.get('args', [])
                    if not isinstance(args, list):
                        raise ValueError('Expected argument list')
                    result = getattr(owner.api, request['method'])(*args)
                    self.json_response({'result': result})
                except Exception as error:
                    self.json_response({'error': str(error)}, 400)

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(directory)))
        self.server.daemon_threads = True
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def evaluate_js(self, script):
        self.events.put({'kind': 'eval', 'script': script})

    def create_file_dialog(self, dialog_type, **options):
        request_id = uuid.uuid4().hex
        entry = {'event': threading.Event(), 'result': None}
        with self.lock:
            self.pending[request_id] = entry
        try:
            self.events.put({'kind': 'dialog', 'id': request_id, 'type': int(dialog_type), 'options': options})
            entry['event'].wait(600)
            return entry['result']
        finally:
            with self.lock:
                self.pending.pop(request_id, None)

    def destroy(self):
        self.events.put({'kind': 'close'})

    def close(self):
        with self.lock:
            for entry in self.pending.values():
                entry['event'].set()
        self.server.shutdown()
        self.server.server_close()
