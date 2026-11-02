"""Exercise the built React UI and its native media geometry with a fake backend."""
import base64
import io
import wave
import json
import os
from pathlib import Path
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from PySide6.QtCore import QEvent, QUrl
from PySide6.QtWidgets import QApplication
from desktop_server import DesktopServer
from desktop_shell import DesktopWindow
from media_browser import MediaPage

class Api:
    def check_model(self):
        return {'present': True, 'model_loaded': False, 'active_model_id': 'test', 'active_language': 'he', 'current_model_id': None, 'gpu': {'cuda_available': False}}
    def get_server_url(self): return None
    def get_languages(self): return [{'code': 'he', 'name': 'Hebrew'}]
    def list_models(self): return []
    def list_sessions(self): return []
    def check_for_update(self): return {'update_available': False, 'current_version': 'test'}
    def get_audio_devices(self): return {'supported': False}

app = QApplication([])
def wait_for(predicate, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate(): return
        time.sleep(.02)
    raise AssertionError('Timed out')
def evaluate(page, script):
    result = []
    page.runJavaScript(script, result.append)
    wait_for(lambda: bool(result))
    return result[0]

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
    server = DesktopServer(Api(), Path(__file__).resolve().parents[1] / 'frontend' / 'dist')
    window = DesktopWindow({'url': server.url + '/index.html', 'server': server.url, 'token': server.token,
        'methods': server.methods, 'profile': directory, 'parent': os.getpid()})
    # This smoke test needs no platform account or network media.
    requests = []
    def open_fixture(url):
        if 'aaaaaaaaaaa' in url and not requests:
            requests.append(url)
            raise RuntimeError('Synthetic navigation failure')
        requests.append(url)
    window.media.open_url = open_fixture
    window.show()
    try:
        wait_for(lambda: evaluate(window.page, '!!document.getElementById("tab-youtube")'))
        wait_for(lambda: evaluate(window.page, '!!window.pywebview?.embeddedMedia'))
        evaluate(window.page, 'document.getElementById("tab-youtube").click()')
        wait_for(lambda: evaluate(window.page, '[...document.querySelectorAll("button")].some(b=>b.textContent==="Sign in")'))
        def submit(address):
            evaluate(window.page, """(() => {
              const input = document.getElementById('media-url');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, %s);
              input.dispatchEvent(new Event('input', {bubbles:true}));
            })()""" % json.dumps(address))
            evaluate(window.page, 'document.querySelector(".youtube-form").requestSubmit()')
        submit('https://instagram.com/reel/test/')
        wait_for(lambda: evaluate(window.page, 'document.getElementById("media-error")?.textContent.includes("YouTube video link")'))
        assert not window.clip.isVisible()
        submit('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        wait_for(lambda: evaluate(window.page, 'document.getElementById("media-error")?.textContent.includes("Synthetic navigation failure")'))
        assert not window.clip.isVisible()
        submit('https://youtu.be/dQw4w9WgXcQ?t=2')
        wait_for(lambda: window.clip.isVisible())
        assert requests[-1] == 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=2s'
        wait_for(lambda: window.clip.isVisible())
        assert not window.media.navigation.isVisible(), 'Browser navigation must be hidden'
        assert window.media.clean.isChecked(), 'Only the selected video should be exposed'
        assert not evaluate(window.page, '!!document.querySelector("iframe")')
        rect = json.loads(evaluate(window.page, 'JSON.stringify(document.querySelector(".native-media-host").getBoundingClientRect().toJSON())'))
        assert abs(window.clip.x() - rect['x']) <= 1
        assert abs(window.clip.y() - rect['y']) <= 1
        assert abs(window.media.width() - rect['width']) <= 1
        window.resize(900, 700)
        wait_for(lambda: abs(window.media.width() - json.loads(evaluate(window.page, 'JSON.stringify(document.querySelector(".native-media-host").getBoundingClientRect().toJSON())'))['width']) <= 1)
        evaluate(window.page, 'document.body.insertAdjacentHTML("beforeend", "<div class=modal-overlay id=test-modal>Modal</div>")')
        wait_for(lambda: not window.clip.isVisible())
        evaluate(window.page, 'document.getElementById("test-modal").remove()')
        wait_for(lambda: window.clip.isVisible())
        evaluate(window.page, 'document.getElementById("tab-transcript").click()')
        wait_for(lambda: not window.clip.isVisible())
        evaluate(window.page, 'document.getElementById("tab-youtube").click()')
        wait_for(lambda: window.clip.isVisible())
        original = MediaPage.acceptNavigationRequest
        MediaPage.acceptNavigationRequest = lambda self, url, kind, main: url.scheme() == 'data' or original(self, url, kind, main)
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
            audio.writeframes(b'\0\0' * 8000 * 30)
        data = base64.b64encode(buffer.getvalue()).decode()
        window.media.view.setHtml(f'<nav>Recommendations</nav><video preload="auto" style="width:400px;height:225px" src="data:audio/wav;base64,{data}"></video>', QUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
        def button(label):
            return 'document.querySelector(\'[aria-label="' + label + '"]\')'
        wait_for(lambda: evaluate(window.page, button('Play video') + ' && !' + button('Play video') + '.disabled'))
        evaluate(window.page, button('0.5× speed') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .5)
        evaluate(window.page, button('Forward 5 seconds') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') >= 4.9)
        evaluate(window.page, button('Set checkpoint') + '.click()')
        wait_for(lambda: evaluate(window.page, '!!' + button('Jump to checkpoint')))
        evaluate(window.page, button('Back 5 seconds') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') < .1)
        evaluate(window.page, button('Jump to checkpoint') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') >= 4.9)
        # Physical W/S/A/D remain the same on Dvorak (./o/a/e).
        def key(code, text, shift=False, repeat=False, target='document.body', extra=''):
            return evaluate(window.page, """(() => {
              const event = new KeyboardEvent('keydown', {code:%s,key:%s,shiftKey:%s,repeat:%s,bubbles:true,cancelable:true,%s});
              %s.dispatchEvent(event); return event.defaultPrevented;
            })()""" % (json.dumps(code), json.dumps(text), json.dumps(shift), json.dumps(repeat), extra, target))
        assert key('KeyD', 'e'), 'Dvorak speed shortcut must be handled'
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .6)
        wait_for(lambda: evaluate(window.page, 'document.querySelector(".youtube-current-speed")?.textContent') == '0.6×')
        key('KeyS', 'o')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == 1)
        key('KeyS', 'o')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .6)
        for _ in range(3): key('KeyD', 'e', repeat=True)
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .9)
        key('KeyA', 'a')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .8)
        assert not key('KeyS', 'o', repeat=True), 'Holding toggle must not oscillate speed'
        assert not key('KeyD', 'e', extra='ctrlKey:true')
        assert not key('KeyD', 'e', target='document.getElementById("media-url")'), 'Typing must not change speed'
        evaluate(window.page, 'document.body.insertAdjacentHTML("beforeend", "<div class=modal-overlay id=shortcut-modal>Modal</div>")')
        assert not key('KeyD', 'e'), 'Modal must disable shortcuts'
        evaluate(window.page, 'document.getElementById("shortcut-modal").remove()')
        evaluate(window.page, button('Forward 5 seconds') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') >= 9.9)
        key('KeyW', '>', shift=True)
        wait_for(lambda: evaluate(window.page, button('Jump to checkpoint') + '.title.includes("0:10")'))
        evaluate(window.page, button('Back 5 seconds') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') < 5.1)
        key('KeyW', '.')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') >= 9.9)
        # Native WebEngine focus must route to the same React controls.
        from PySide6.QtCore import Qt
        from PySide6.QtTest import QTest
        window.media.view.setFocus()
        QTest.keyClick(window.media.view.focusProxy(), Qt.Key.Key_A)
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").playbackRate') == .7)
        wait_for(lambda: evaluate(window.page, 'document.querySelector(".youtube-current-speed")?.textContent') == '0.7×')
        evaluate(window.page, button('Back 5 seconds') + '.click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') < 5.1)
        QTest.keyClick(window.media.view.focusProxy(), Qt.Key.Key_W)
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").currentTime') >= 9.9)
        # Clicking the video surface toggles playback and updates the app button.
        from PySide6.QtCore import QPoint
        center = QPoint(window.media.view.width() // 2, window.media.view.height() // 2)
        QTest.mouseClick(window.media.view.focusProxy(), Qt.MouseButton.LeftButton, pos=center)
        wait_for(lambda: not evaluate(window.media.page, 'document.querySelector("video").paused'), timeout=3)
        wait_for(lambda: evaluate(window.page, '!!' + button('Pause video')))
        QTest.mouseClick(window.media.view.focusProxy(), Qt.MouseButton.LeftButton, pos=center)
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").paused'), timeout=3)
        wait_for(lambda: evaluate(window.page, '!!' + button('Play video')))
        evaluate(window.page, button('Play video') + '.click()')
        wait_for(lambda: not evaluate(window.media.page, 'document.querySelector("video").paused'))
        evaluate(window.page, 'document.getElementById("tab-transcript").click()')
        wait_for(lambda: evaluate(window.media.page, 'document.querySelector("video").paused'))
        assert not key('KeyD', 'e'), 'Inactive Media tab must ignore shortcuts'
        evaluate(window.page, 'document.getElementById("tab-youtube").click()')
        wait_for(lambda: window.clip.isVisible())
        wait_for(lambda: evaluate(window.page, 'document.getElementById("tab-youtube").getAttribute("aria-selected")') == 'true')
        wait_for(lambda: evaluate(window.page, 'document.querySelector(".youtube-controls").getBoundingClientRect().width') > 0)
        # A stalled shortcut must not execute after leaving and returning to Media.
        evaluate(window.page, """(() => {
          const original = window.pywebview.api.media_command;
          window.restoreMediaCommand = () => {window.pywebview.api.media_command = original;};
          let hold = true; window.delayedRateCalls = 0;
          window.pywebview.api.media_command = async (...args) => {
            if(args[0] === 'rate') window.delayedRateCalls++;
            if(args[0] === 'status' && hold) {
              hold = false; const state = await original(...args);
              return new Promise(resolve => {window.releaseStatus = () => resolve(state);});
            }
            return original(...args);
          };
          document.body.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyD',key:'e',bubbles:true}));
        })()""")
        wait_for(lambda: evaluate(window.page, 'typeof window.releaseStatus === "function"'))
        evaluate(window.page, 'document.getElementById("tab-transcript").click()')
        wait_for(lambda: not window.clip.isVisible())
        evaluate(window.page, 'document.getElementById("tab-youtube").click()')
        wait_for(lambda: window.clip.isVisible())
        evaluate(window.page, 'window.releaseStatus()')
        deadline = time.monotonic() + .3
        while time.monotonic() < deadline:
            app.processEvents(); time.sleep(.02)
        assert evaluate(window.page, 'window.delayedRateCalls') == 0, 'Stale shortcut must be cancelled across tab changes'
        evaluate(window.page, 'window.restoreMediaCommand()')
        # Let the compositor paint the new React tab before taking the screenshot.
        deadline = time.monotonic() + .25
        while time.monotonic() < deadline:
            app.processEvents(); time.sleep(.02)
        window.grab().save('/tmp/speaktospeech-in-app-media.png')
        print('PASS: built React app, YouTube URL validation, failed launch/retry, focused controls, speed/seek/checkpoint, pause on tab exit, native Media panel geometry, resize, modal hiding, tab switching')
    finally:
        window.close(); app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        window.media.profile.deleteLater(); window.profile.deleteLater()
        app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        server.close()
