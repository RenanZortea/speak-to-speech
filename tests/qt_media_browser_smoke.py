import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import wave
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QUrl, QEvent
from media_browser import MediaBrowser, MediaPage, WORLD
original_navigation = MediaPage.acceptNavigationRequest
# Only the synthetic test fixture needs data: navigation; production rejects it.
MediaPage.acceptNavigationRequest = lambda self, url, kind, main: url.scheme() == 'data' or original_navigation(self, url, kind, main)
from media_browser_scripts import media_script

app = QApplication([])
def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate(): return
        time.sleep(.02)
    raise AssertionError('Timed out')
def evaluate(browser, script):
    result = []
    browser.page.runJavaScript(script, WORLD, lambda value: result.append(value))
    wait_for(lambda: len(result))
    return result[0]

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
    browser = MediaBrowser(profile)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
        audio.writeframes(b'\0\0' * 8000 * 4)
    data = base64.b64encode(buffer.getvalue()).decode()
    html = '<ytd-watch-flexy><section id="comments">Comments</section><div id="video">Video stays visible</div></ytd-watch-flexy>'
    html += f'<audio controls preload="auto" src="data:audio/wav;base64,{data}"></audio>'
    loaded = []
    browser.view.loadFinished.connect(lambda ok: loaded.append(ok))
    browser.view.setHtml(html, QUrl('https://www.youtube.com/watch?v=test'))
    wait_for(lambda: loaded)
    assert loaded[-1], loaded
    browser.clean.setChecked(True)
    assert evaluate(browser, "getComputedStyle(document.querySelector('#comments')).display") == 'none'
    assert evaluate(browser, "getComputedStyle(document.querySelector('#video')).display") != 'none'
    browser.clean.setChecked(False)
    assert evaluate(browser, "getComputedStyle(document.querySelector('#comments')).display") != 'none'
    wait_for(lambda: json.loads(evaluate(browser, media_script('status'))).get('available'))
    assert json.loads(evaluate(browser, media_script('rate', 0.75)))['rate'] == 0.75
    assert json.loads(evaluate(browser, media_script('seek', 2)))['time'] >= 1.9
    assert json.loads(evaluate(browser, media_script('seek', -100)))['time'] == 0
    assert evaluate(browser, 'typeof window.pywebview') == 'undefined'
    assert not browser.profile.isOffTheRecord()
    print('PASS: native browser, clean CSS toggle, video preservation, playback status, speed, seek bounds, persistent profile, no Python bridge')
    browser.close()
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    browser.profile.deleteLater()
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
