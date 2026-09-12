import http.client
import socketserver
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from backend.audio_server import AudioServer, _Handler


class AudioWorkspaceTests(unittest.TestCase):
    def test_old_recording_urls_and_range_seeks_keep_their_source(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "main.wav"
            second = Path(directory) / "youtube.wav"
            first.write_bytes(b"main recording")
            second.write_bytes(b"youtube recording")
            audio = AudioServer(recordings_dir=directory)

            class Handler(_Handler):
                server_ref = audio

            with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler) as server:
                audio._port = server.server_address[1]
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    audio.set_audio(str(first))
                    main_url = audio.url
                    audio.set_audio(str(second))
                    youtube_url = audio.url

                    def get(url, headers=None):
                        parts = urlsplit(url)
                        connection = http.client.HTTPConnection(parts.hostname, parts.port)
                        connection.request("GET", parts.path + "?" + parts.query, headers=headers or {})
                        response = connection.getresponse()
                        result = response.status, response.read()
                        connection.close()
                        return result

                    self.assertEqual(get(main_url), (200, b"main recording"))
                    self.assertEqual(get(youtube_url), (200, b"youtube recording"))
                    self.assertEqual(get(main_url, {"Range": "bytes=0-3"}), (206, b"main"))
                    self.assertEqual(get(youtube_url, {"Range": "bytes=0-6"}), (206, b"youtube"))
                    self.assertEqual(get(audio.base_url + "/audio?v=unknown")[0], 404)
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
