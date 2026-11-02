"""Check focused YouTube controls without relying on an account or live ads."""
import json
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from PySide6.QtCore import QEvent, QUrl, Qt
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication
from media_browser import MediaBrowser, MediaPage, WORLD

app = QApplication([])
def wait_for(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate(): return
        time.sleep(.02)
    raise AssertionError('Timed out')
def evaluate(page, script, world=0):
    results = []
    page.runJavaScript(script, world, results.append)
    wait_for(lambda: bool(results))
    return results[0]

html = '''<style>
#movie_player { position:relative; width:640px; height:360px; }
.ytp-chrome-bottom { position:absolute; bottom:0; height:50px; width:100%; opacity:0; }
.ytp-settings-menu { position:absolute; right:10px; bottom:60px; background:#333; }
.ytp-ad-skip-button-container { position:absolute; right:10px; top:10px; }
.ytp-caption-window-container { position:absolute; bottom:80px; }
</style><nav id="outside">Browse other pages</nav><main><div id="movie_player" class="html5-video-player">
<video style="width:640px;height:360px"></video>
<div class="ytp-caption-window-container"><span id="caption">Caption text</span></div>
<div class="ytp-chrome-bottom">
<input id="timeline" type="range" min="0" max="100" value="0" oninput="window.seek=Number(this.value)">
<button class="ytp-subtitles-button" onclick="window.captions=true">CC</button>
<button class="ytp-settings-button" onclick="document.getElementById('settings').style.display='block'">Settings</button>
<button class="ytp-next-button" onclick="window.escaped=true">Next video</button>
<a id="escape" href="https://example.com/" onclick="window.escaped=true">External link</a>
</div>
<div id="settings" class="ytp-settings-menu" style="display:none"><button role="menuitem" onclick="window.quality='720p'">720p</button></div>
<div class="ytp-ad-skip-button-container"><button class="ytp-ad-skip-button" onclick="window.skipped=true">Skip ad</button></div>
<div class="ytp-endscreen-content">Recommendations</div>
</div></main>'''

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
    browser = MediaBrowser(profile, embedded=True)
    # Permit only the synthetic HTML fixture; do not alter production URL policy.
    original = MediaPage.acceptNavigationRequest
    MediaPage.acceptNavigationRequest = lambda self, url, kind, main: url.scheme() == 'data' or original(self, url, kind, main)
    browser.show()
    browser.view.setHtml(html, QUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
    try:
        wait_for(lambda: evaluate(browser.page, '!!document.getElementById("timeline")'))
        browser.apply_clean()
        def visible(selector):
            return evaluate(browser.page, '''(() => {const e=document.querySelector(%s),s=getComputedStyle(e);return s.visibility==='visible' && s.display!=='none' && e.getBoundingClientRect().width>0;})()''' % json.dumps(selector))
        assert visible('.ytp-settings-button'), 'Native settings must remain visible'
        assert visible('#timeline'), 'The YouTube seek bar must remain visible'
        assert visible('#caption'), 'Captions must remain visible'
        assert visible('.ytp-ad-skip-button'), 'YouTube ad skip must remain visible'
        assert not visible('#outside')
        assert not visible('.ytp-next-button')
        assert not visible('.ytp-endscreen-content')
        assert not visible('#escape')
        # Genuine pointer events must reach allowed controls, not just script clicks.
        def click(selector):
            point = json.loads(evaluate(browser.page, '''(() => {const r=document.querySelector(%s).getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()''' % json.dumps(selector)))
            from PySide6.QtCore import QPoint
            QTest.mouseClick(browser.view.focusProxy(), Qt.MouseButton.LeftButton, pos=QPoint(round(point['x']), round(point['y'])))
        click('.ytp-settings-button')
        wait_for(lambda: visible('#settings'))
        click('[role=menuitem]')
        wait_for(lambda: evaluate(browser.page, 'window.quality') == '720p')
        click('.ytp-subtitles-button')
        wait_for(lambda: evaluate(browser.page, 'window.captions === true'))
        click('.ytp-ad-skip-button')
        wait_for(lambda: evaluate(browser.page, 'window.skipped === true'))
        click('#timeline')
        QTest.keyClick(browser.view.focusProxy(), Qt.Key.Key_Right)
        wait_for(lambda: evaluate(browser.page, 'window.seek > 0'))
        # Even script-triggered link clicks are filtered before YouTube's handlers.
        evaluate(browser.page, 'document.getElementById("escape").click()')
        assert not evaluate(browser.page, 'window.escaped === true')
        browser.apply_clean()
        assert visible('#settings'), 'Refreshing focus must not close a settings menu'
        # YouTube reparents the same player after its initial shell loads.
        evaluate(browser.page, "const wrapper=document.createElement('section'); document.body.appendChild(wrapper); wrapper.appendChild(document.getElementById('movie_player'));")
        browser.apply_clean()
        assert visible('.ytp-settings-button'), 'Controls must survive player reparenting'
        click('.ytp-subtitles-button')
        print('PASS: native timeline, keyboard seeking, captions, settings selection, ad skip; navigation stays blocked')
    finally:
        browser.close()
        app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        browser.profile.deleteLater()
        app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
