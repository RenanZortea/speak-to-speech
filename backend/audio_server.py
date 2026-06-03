"""
Tiny localhost HTTP server.

Endpoints:
  GET  /audio      → streams the currently-selected audio file (HTTP Range supported)
  POST /upload     → writes the request body to recordings dir, sets it as current, returns JSON
  OPTIONS /upload  → CORS preflight (needed in dev: Vite at :5173 ↔ this server on random port)
"""
import http.server
import json
import mimetypes
import os
import secrets
import socketserver
import threading
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit


DEFAULT_RECORDINGS_DIR = Path.home() / "SpeakToSpeech" / "recordings"


class _Handler(http.server.BaseHTTPRequestHandler):
    server_ref = None  # bound per-instance via factory

    def log_message(self, *args, **kwargs):
        return  # silence

    # ---- CORS preflight ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Audio-Ext")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    # ---- POST /upload ----
    def do_POST(self):
        if urlsplit(self.path).path != "/upload":
            self.send_error(404)
            return

        ext = self.headers.get("X-Audio-Ext", "webm").lstrip(".")
        # whitelist extensions to avoid path tricks
        if not ext.isalnum() or len(ext) > 6:
            ext = "webm"

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json(400, {"error": "empty body"})
            return

        save_dir = self.server_ref.recordings_dir
        save_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_path = save_dir / f"recording-{ts}.{ext}"

        try:
            remaining = length
            with open(out_path, "wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
        except Exception as e:
            self._send_json(500, {"error": f"write failed: {e}"})
            return

        self.server_ref.set_audio(str(out_path))
        self._send_json(200, {"path": str(out_path), "url": self.server_ref.url})

    # ---- GET /audio ----
    def do_GET(self):
        if urlsplit(self.path).path != "/audio":
            self.send_error(404)
            return
        path = self.server_ref.current_path
        if not path or not os.path.isfile(path):
            self.send_error(404, "no audio selected")
            return

        size = os.path.getsize(path)
        ctype, _ = mimetypes.guess_type(path)
        if not ctype:
            # Fallbacks for formats Windows sometimes returns None for
            ext = os.path.splitext(path)[1].lower()
            ctype = {
                ".webm": "audio/webm",
                ".opus": "audio/ogg",
                ".m4a": "audio/mp4",
            }.get(ext, "application/octet-stream")

        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                start_s, end_s = rng[len("bytes="):].split("-")
                start = int(start_s)
                end = int(end_s) if end_s else size - 1
                if start >= size or end >= size or start > end:
                    raise ValueError
            except ValueError:
                self.send_error(416)
                return
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self._stream(path, start, length)
        else:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self._stream(path, 0, size)

    # ---- helpers ----
    def _stream(self, path, start, length):
        try:
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # client disconnected (normal on seek / source-swap)

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


class AudioServer:
    def __init__(self, recordings_dir: Path = DEFAULT_RECORDINGS_DIR):
        self.current_path = None
        self.recordings_dir = Path(recordings_dir)
        self._port = None
        self._token = secrets.token_hex(4)

    @property
    def url(self):
        # Token changes each set_audio() call so the <audio> element actually
        # reloads when the underlying file is swapped.
        return f"http://127.0.0.1:{self._port}/audio?v={self._token}" if self._port else None

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self._port}" if self._port else None

    def set_audio(self, path: str):
        self.current_path = path
        self._token = secrets.token_hex(4)

    def start(self):
        server_ref = self

        class BoundHandler(_Handler):
            pass

        BoundHandler.server_ref = server_ref

        srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), BoundHandler)
        srv.daemon_threads = True
        self._port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
