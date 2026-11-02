import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from desktop_server import DesktopServer


class TestApi:
    def echo(self, value):
        return value

    def fail(self):
        raise ValueError('Expected failure')

    def _private(self):
        raise AssertionError('Private methods must not be exposed')


class DesktopServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        (Path(self.directory.name) / 'index.html').write_text('<h1>Local app</h1>')
        self.server = DesktopServer(TestApi(), self.directory.name)

    def tearDown(self):
        self.server.close()
        self.directory.cleanup()

    def request(self, path, value=None, token=True):
        headers = {'Authorization': 'Bearer ' + self.server.token} if token else {}
        request = urllib.request.Request(self.server.url + path,
            data=json.dumps(value).encode() if value is not None else None, headers=headers)
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.load(response)

    def test_rpc_roundtrip_and_error(self):
        self.assertEqual(self.request('/rpc', {'method': 'echo', 'args': [{'text': 'שלום'}]}), {'result': {'text': 'שלום'}})
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/rpc', {'method': 'fail'})
        self.assertEqual(json.load(error.exception)['error'], 'Expected failure')

    def test_authentication_and_private_method_rejection(self):
        for path, value in [('/events', None), ('/rpc', {'method': 'echo', 'args': [1]})]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, value, token=False)
            self.assertEqual(error.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/rpc', {'method': '_private'})
        self.assertEqual(error.exception.code, 404)

    def test_events_and_file_dialog_reply(self):
        self.server.evaluate_js('window.__emit("ready", {});')
        self.assertEqual(self.request('/events')[0]['kind'], 'eval')
        result = []
        worker = threading.Thread(target=lambda: result.append(self.server.create_file_dialog(10)))
        worker.start()
        # Wait on the queue directly to avoid timing assumptions in the polling test.
        event = self.server.events.get(timeout=2)
        self.request('/ui-reply', {'id': event['id'], 'result': ['/tmp/recording.wav']})
        worker.join(timeout=2)
        self.assertEqual(result, [['/tmp/recording.wav']])

    def test_serves_only_public_frontend_without_exposing_token(self):
        with urllib.request.urlopen(self.server.url + '/index.html') as response:
            html = response.read().decode()
        self.assertIn('Local app', html)
        self.assertNotIn(self.server.token, html)
