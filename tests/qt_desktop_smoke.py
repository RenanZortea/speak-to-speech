"""Run explicitly with a working Qt display/runtime (offscreen also works)."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import wave
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from PySide6.QtCore import QEvent, QUrl
from PySide6.QtWidgets import QApplication
from desktop_server import DesktopServer
from desktop_shell import DesktopWindow
from media_browser import MediaPage, AuthPage, WORLD
from media_browser_scripts import clean_script

class Api:
    def echo(self, value):
        return value

app = QApplication([])
def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate(): return
        time.sleep(.02)
    raise AssertionError('Timed out')
def evaluate(page, script, world=0):
    result = []
    page.runJavaScript(script, world, result.append)
    wait_for(lambda: bool(result))
    return result[0]

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
    root = Path(directory)
    (root / 'index.html').write_text('<h1>Local UI</h1><script>window.__emit=(name,data)=>{window.lastEvent=data;}</script>')
    server = DesktopServer(Api(), root)
    config = {'url': server.url + '/index.html', 'server': server.url, 'token': server.token,
              'methods': server.methods, 'profile': str(root / 'profile'), 'parent': os.getpid()}
    window = DesktopWindow(config)
    window.show()
    try:
        wait_for(lambda: window.page_ready)
        wait_for(lambda: evaluate(window.page, '!!window.pywebview?.embeddedMedia'))
        evaluate(window.page, "window.pywebview.api.echo('bridge works').then(value=>window.bridgeResult=value)")
        wait_for(lambda: evaluate(window.page, 'window.bridgeResult') == 'bridge works')
        server.evaluate_js("window.__emit('test', 'event works')")
        wait_for(lambda: evaluate(window.page, 'window.lastEvent') == 'event works')
        window.media_open = True
        bounds = {'visible': True, 'x': 100, 'y': 120, 'width': 650, 'height': 430,
                  'clip': {'x': 100, 'y': 120, 'width': 650, 'height': 430}}
        window.position_media(bounds)
        assert window.media.window() is window
        assert not window.media.isWindow()
        assert window.clip.isVisible()
        assert window.clip.geometry().width() == 650
        window.position_media({'visible': False})
        assert not window.clip.isVisible()
        window.position_media(bounds)
        # Only synthetic fixture navigation permits data: URLs.
        original = MediaPage.acceptNavigationRequest
        MediaPage.acceptNavigationRequest = lambda self, url, kind, main: url.scheme() == 'data' or original(self, url, kind, main)
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
            audio.writeframes(b'\0\0' * 8000 * 3)
        data = base64.b64encode(buffer.getvalue()).decode()
        html = f'<nav id="nav">Instagram</nav><main><article><aside id="comments">Comments</aside><div><video controls src="data:audio/wav;base64,{data}" preload="auto" style="width:300px;height:300px"></video></div></article></main>'
        loaded = []
        window.media.view.loadFinished.connect(loaded.append)
        window.media.view.setHtml(html, QUrl('https://www.youtube.com/watch?v=test'))
        wait_for(lambda: loaded)
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").readyState', WORLD) > 0)
        window.media.apply_clean()
        wait_for(lambda: evaluate(window.media.page, '!!document.querySelector("[data-sts-focus-video]")', WORLD))
        assert evaluate(window.media.page, 'getComputedStyle(document.querySelector("#nav")).display', WORLD) == 'none'
        assert evaluate(window.media.page, 'getComputedStyle(document.querySelector("#comments")).display', WORLD) == 'none'
        assert evaluate(window.media.page, 'getComputedStyle(document.querySelector("video")).position', WORLD) == 'fixed'
        assert evaluate(window.media.page, 'typeof window.pywebview', WORLD) == 'undefined'
        assert not window.media.navigation.isVisible()
        assert not evaluate(window.media.page, 'document.querySelector("video").controls', WORLD)
        assert evaluate(window.media.page, 'getComputedStyle(document.querySelector("video")).visibility', WORLD) == 'visible'
        # App-owned controls drive the real native HTML media through the bridge.
        def command(action, value=0):
            evaluate(window.page, 'window.controlResult=null; window.pywebview.api.media_command(%s,%s).then(value=>window.controlResult=value)' % (json.dumps(action), value))
            wait_for(lambda: evaluate(window.page, 'window.controlResult !== null'))
            return json.loads(evaluate(window.page, 'JSON.stringify(window.controlResult)'))
        assert command('status')['available']
        assert command('rate', .5)['rate'] == .5
        assert command('seek_to', 2)['time'] >= 1.9
        assert command('seek', -100)['time'] == 0
        command('play')
        wait_for(lambda: not evaluate(window.media.page, 'document.querySelector("video").paused', WORLD))
        command('pause')
        assert evaluate(window.media.page, 'document.querySelector("video").paused', WORLD)
        window.media.page.selected_id = 'dQw4w9WgXcQ'
        assert not original(window.media.page, QUrl('https://example.com/'), 0, True)
        assert not original(window.media.page, QUrl('https://www.youtube.com/watch?v=abcdefghijk'), 0, True)
        auth = AuthPage(window.media.profile, window)
        assert auth.profile() is window.media.profile
        assert auth.acceptNavigationRequest(QUrl('https://accounts.google.com/ServiceLogin'), 0, True)
        assert not auth.acceptNavigationRequest(QUrl('https://example.com/'), 0, True)
        returned = []
        auth.returned.connect(lambda: returned.append(True))
        assert not auth.acceptNavigationRequest(QUrl('https://www.youtube.com/'), 0, True)
        assert returned
        auth.deleteLater()
        print('PASS: in-window media parentage, positioning/hiding, local API bridge, backend events, isolated remote page, focused video, native playback RPC, restricted navigation/authentication')
    finally:
        window.close()
        app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        window.media.profile.deleteLater(); window.profile.deleteLater()
        app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        server.close()
