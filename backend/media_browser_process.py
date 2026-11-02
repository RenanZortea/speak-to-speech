"""Own a Qt browser subprocess so GTK and Qt never share an event loop."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

from media_browser_scripts import validate_media_url


def browser_python():
    """Prefer distro Qt on Linux, where it can include codecs absent from wheels."""
    override = os.environ.get('SPEAKTOSPEECH_BROWSER_PYTHON')
    if override:
        return override
    candidate = Path('/usr/bin/python')
    if sys.platform == 'linux' and candidate.exists():
        try:
            result = subprocess.run([str(candidate), '-c',
                'import psutil; from PySide6 import QtCore, QtWebEngineWidgets; '
                'assert tuple(map(int, QtCore.qVersion().split(".")[:2])) >= (6, 8)'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            if result.returncode == 0:
                return str(candidate)
        except (OSError, subprocess.TimeoutExpired):
            pass
    return sys.executable


class MediaBrowserProcess:
    def __init__(self, profile_dir):
        self.profile_dir = Path(profile_dir)
        self._process = None
        self._ipc = None
        self._lock = threading.RLock()
        self._sequence = 0

    def _write(self, command):
        self._sequence += 1
        path = Path(self._ipc.name) / 'command.json'
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps({**command, 'sequence': self._sequence}), encoding='utf-8')
        temporary.replace(path)

    def open(self, url):
        validate_media_url(url)
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                self._write({'action': 'open', 'url': url})
                return {'opened': True}
            self.close()
            self._ipc = tempfile.TemporaryDirectory(prefix='speaktospeech-browser-')
            self._write({'action': 'open', 'url': url})
            if getattr(sys, 'frozen', False):
                command = [sys.executable, '--media-browser']
            else:
                command = [browser_python(), str(Path(__file__).with_name('media_browser.py'))]
            command += ['--ipc', self._ipc.name, '--profile', str(self.profile_dir), '--parent', str(os.getpid())]
            # Qt inherits no pywebview API, fake microphone permission flags, or local app page.
            try:
                self._process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                ready = Path(self._ipc.name) / 'ready'
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if self._process.poll() is not None:
                        raise RuntimeError('Qt media browser could not start. Install backend/requirements.txt in the app’s Python environment and check Qt display support.')
                    if ready.exists():
                        return {'opened': True}
                    time.sleep(0.05)
                raise RuntimeError('Qt media browser did not become ready. Check your desktop display and Qt installation.')
            except Exception:
                self.close()
                raise

    def close(self):
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                self._write({'action': 'close'})
                try:
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.terminate()
                    try:
                        self._process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        self._process.kill()
                        self._process.wait()
            self._process = None
            if self._ipc is not None:
                self._ipc.cleanup()
                self._ipc = None
