"""Small Qt WebEngine media browser. Remote pages have no Python bridge."""
import argparse
import json
from pathlib import Path
import sys

import psutil

from PySide6.QtCore import Qt, QEvent, QTimer, QUrl, Signal
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QComboBox, QLabel, QLineEdit, QMainWindow, QToolBar
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineScript, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView

from media_browser_scripts import clean_script, focused_script, media_script, validate_media_url

from media_policy import video_id, practice_navigation_allowed, auth_navigation_allowed, safe_https, AUTH_HOSTS

WORLD = QWebEngineScript.ScriptWorldId.ApplicationWorld.value


class MediaPage(QWebEnginePage):
    consentRequested = Signal(str)

    def __init__(self, profile, parent=None, focused=False):
        super().__init__(profile, parent)
        self.focused = focused
        self.selected_id = None

    def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
        if not self.focused:
            return url.scheme() in {'https', 'about'}
        if not is_main_frame:
            return url.scheme() in {'https', 'about'}
        target = url.toString()
        parsed = safe_https(target)
        if parsed and parsed.hostname in {'consent.youtube.com', 'consent.google.com'}:
            self.consentRequested.emit(target)
            return False
        return practice_navigation_allowed(target, self.selected_id)


class AuthPage(QWebEnginePage):
    returned = Signal()

    def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
        if not auth_navigation_allowed(url.toString()):
            return False
        if is_main_frame and url.host() not in AUTH_HOSTS and url.path() in {'/', '/watch'}:
            self.returned.emit()
            return False
        return True


class LoginView(QWebEngineView):
    closed = Signal()

    def closeEvent(self, event):
        self.closed.emit()
        super().closeEvent(event)


class MediaBrowser(QMainWindow):
    shortcutRequested = Signal(str)

    def __init__(self, profile_dir, parent=None, embedded=False):
        super().__init__(parent)
        self.embedded = embedded
        self.login_view = None
        self.selected_url = None
        self.load_error = None
        if embedded:
            self.setWindowFlags(Qt.WindowType.Widget)
        self._closing = False
        self.setWindowTitle('SpeakToSpeech — Media browser')
        self.resize(1050, 820)
        profile_dir = Path(profile_dir)
        profile_dir.mkdir(parents=True, exist_ok=True)
        self.profile = QWebEngineProfile('SpeakToSpeechMedia', self)
        self.profile.setPersistentStoragePath(str(profile_dir / 'storage'))
        self.profile.setCachePath(str(profile_dir / 'cache'))
        self.profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)
        self.profile.downloadRequested.connect(lambda download: download.cancel())
        self.view = QWebEngineView(self)
        self.page = MediaPage(self.profile, self.view, focused=embedded)
        self.view.setPage(self.page)
        if embedded:
            self.view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
            self.view.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
            script = QWebEngineScript()
            script.setName('Focused YouTube surface')
            script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
            script.setWorldId(WORLD)
            script.setRunsOnSubFrames(False)
            script.setSourceCode(focused_script())
            self.page.scripts().insert(script)
            self.page.consentRequested.connect(lambda url: QTimer.singleShot(0, lambda: self.sign_in(url)))

        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, not embedded)
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True)
        self.page.fullScreenRequested.connect(self.fullscreen)
        self.page.newWindowRequested.connect(self.new_window)
        self.setCentralWidget(self.view)
        navigation = QToolBar('Navigation', self)
        self.addToolBar(navigation)
        self.navigation = navigation
        for label, callback in [('Back', self.view.back), ('Forward', self.view.forward), ('Reload', self.view.reload)]:
            navigation.addAction(label).triggered.connect(callback)
        self.address = QLineEdit()
        self.address.setPlaceholderText('YouTube URL')
        self.address.returnPressed.connect(self.open_address)
        navigation.addWidget(self.address)
        for name, url in [('YouTube', 'https://www.youtube.com/')]:
            navigation.addAction(name).triggered.connect(lambda checked=False, u=url: self.open_url(u))
        self.clean = QAction('Clean view', self)
        self.clean.setCheckable(True)
        self.clean.setChecked(embedded)
        self.clean.setText('Video only')
        self.clean.toggled.connect(self.apply_clean)
        navigation.addAction(self.clean)
        self.addToolBarBreak()
        playback = QToolBar('Practice playback', self)
        self.addToolBar(playback)
        navigation.addAction('Open in browser').triggered.connect(self.open_external)
        self.playback_actions = []
        for label, action, value in [('Play', 'play', 0), ('Pause', 'pause', 0),
                                     ('Back 5s', 'seek', -5), ('Back 1s', 'seek', -1),
                                     ('Forward 1s', 'seek', 1), ('Forward 5s', 'seek', 5)]:
            button = playback.addAction(label)
            button.triggered.connect(lambda checked=False, a=action, v=value: self.control(a, v))
            button.setEnabled(False)
            self.playback_actions.append(button)
        self.speed = QComboBox()
        for rate in [0.5, 0.75, 1, 1.25, 1.5, 2]:
            self.speed.addItem(f'{rate:g}×', rate)
        self.speed.setCurrentIndex(2)
        self.speed.setEnabled(False)
        self.speed.activated.connect(lambda index: self.control('rate', self.speed.itemData(index)))
        playback.addWidget(self.speed)
        if embedded:
            navigation.hide()
            playback.hide()
            self.statusBar().hide()
        self.position = QLabel('Use the website player to start playback.')
        playback.addWidget(self.position)
        self.view.urlChanged.connect(self.url_changed)
        self.view.loadFinished.connect(self.loaded)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(700)
        self.shortcut_pending = False
        self.shortcut_timer = QTimer(self)
        self.shortcut_timer.timeout.connect(self.poll_shortcuts)
        if embedded:
            self.shortcut_timer.start(50)
        self.statusBar().showMessage('Sign in on the website. Record using the Source panel in SpeakToSpeech.')

    def open_url(self, url):
        try:
            validate_media_url(url)
            if self.embedded:
                self.page.selected_id = video_id(url)
                self.selected_url = url
            self.load_error = None
            self.view.setUrl(QUrl(url))
            if not self.embedded:
                self.showNormal(); self.raise_(); self.activateWindow()
        except ValueError as error:
            if self.embedded:
                raise
            self.statusBar().showMessage(str(error))

    def open_external(self):
        from media_links import open_media_url
        try:
            open_media_url(self.view.url().toString())
            self.control('pause', 0)
            self.statusBar().showMessage('Opened in your browser. Record using the Source panel.')
        except (ValueError, RuntimeError) as error:
            self.statusBar().showMessage(str(error))

    def open_address(self):
        value = self.address.text().strip()
        self.open_url(value if '://' in value else 'https://' + value)

    def url_changed(self, url):
        if self._closing:
            return
        if self.embedded and self.selected_url and not practice_navigation_allowed(url.toString(), self.page.selected_id):
            # YouTube can navigate through history.pushState without a network load.
            self.view.stop()
            self.control('pause', 0)
            QTimer.singleShot(0, lambda: self.open_url(self.selected_url) if not self._closing else None)
            return
        self.address.setText(url.toString())
        self.apply_clean()

    def loaded(self, ok):
        if self._closing:
            return
        self.load_error = None if ok else 'YouTube could not load. Reload the video or sign in.'
        self.apply_clean()
        self.statusBar().showMessage('Record using the Source panel. Sign in through the YouTube website if needed.' if ok
                                    else 'Page failed to load. Check the connection or use Reload.')

    def apply_clean(self, *_):
        if self._closing:
            return
        self.page.runJavaScript(focused_script() if self.embedded else clean_script(self.clean.isChecked()), WORLD)

    def refresh(self):
        if self._closing:
            return
        self.apply_clean()
        action = 'pause' if self.embedded and not self.isVisible() else 'status'
        self.page.runJavaScript(media_script(action), WORLD, self.update_playback)

    def poll_shortcuts(self):
        if self._closing or self.shortcut_pending:
            return
        self.shortcut_pending = True
        enabled = self.isVisible() and self.login_view is None
        script = """JSON.stringify((window.__stsPracticeKeys || []).splice(0)
            .filter(item => performance.now() - item.time < 500).map(item => item.action))"""
        def received(encoded):
            self.shortcut_pending = False
            if self._closing or not enabled or not self.isVisible() or self.login_view is not None:
                return
            try:
                actions = json.loads(encoded) if isinstance(encoded, str) else []
            except ValueError:
                return
            if not isinstance(actions, list):
                return
            for action in actions[:32]:
                if action in ('set-checkpoint', 'jump-checkpoint', 'toggle-speed', 'slower', 'faster'):
                    self.shortcutRequested.emit(action)
        self.page.runJavaScript(script, WORLD, received)

    def update_playback(self, state):
        if self._closing:
            return
        if isinstance(state, str):
            try:
                state = json.loads(state)
            except ValueError:
                state = None
        available = isinstance(state, dict) and state.get('available', False)
        for action in self.playback_actions:
            action.setEnabled(available)
        self.speed.setEnabled(available)
        if available:
            self.position.setText(f"  {int(state.get('time', 0))}s / {int(state.get('duration', 0))}s")
            index = self.speed.findData(state.get('rate', 1))
            if index >= 0:
                self.speed.setCurrentIndex(index)
        else:
            self.position.setText('  Use the website’s playback controls.')

    def control(self, action, value):
        if self._closing:
            return
        self.page.runJavaScript(media_script(action, value), WORLD, self.update_playback)

    def command(self, action, value, callback):
        script = media_script(action, value)
        if action == 'play' and self.embedded and not self.isVisible():
            callback({'available': False, 'error': 'Return to Media before playing the video.'})
            return
        if self.login_view is not None and action not in {'status', 'pause'}:
            callback({'available': False, 'signingIn': True})
            return
        def received(encoded):
            try:
                state = json.loads(encoded) if isinstance(encoded, str) else {}
            except ValueError:
                state = {}
            if not isinstance(state, dict):
                state = {}
            state['signingIn'] = self.login_view is not None
            if self.load_error:
                state['error'] = self.load_error
            callback(state)
        self.page.runJavaScript(script, WORLD, received)

    def sign_in(self, address=None):
        if self._closing:
            return
        if self.login_view is not None:
            self.login_view.raise_()
            self.login_view.activateWindow()
            return
        self.control('pause', 0)
        popup = LoginView(self)
        self.login_view = popup
        popup.setWindowFlag(Qt.WindowType.Window)
        popup.setWindowTitle('Sign in to YouTube')
        popup.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        popup.resize(560, 720)
        page = AuthPage(self.profile, popup)
        popup.setPage(page)
        page.returned.connect(popup.close, Qt.ConnectionType.QueuedConnection)
        page.windowCloseRequested.connect(popup.close)
        page.newWindowRequested.connect(lambda request: request.openIn(page))
        def closed():
            self.login_view = None
            page.deleteLater()
            popup.deleteLater()
            if not self._closing and self.selected_url:
                self.open_url(self.selected_url)
        popup.closed.connect(closed)
        popup.setUrl(QUrl(address or 'https://www.youtube.com/signin?next=%2F'))
        popup.show()

    def new_window(self, request):
        if self.embedded:
            return  # Popups are only opened by the app-owned Sign in action.
        # Keep login popups in a separate page using the same persistent profile.
        popup = QWebEngineView(self)
        popup.setWindowFlag(Qt.WindowType.Window)
        popup_page = MediaPage(self.profile, popup)
        popup.setPage(popup_page)
        popup.resize(650, 750)
        popup_page.windowCloseRequested.connect(popup.close)
        request.openIn(popup_page)
        popup.show()
        if not hasattr(self, '_popups'):
            self._popups = []
        self._popups.append(popup)

    def fullscreen(self, request):
        if self.embedded:
            request.reject()
            return
        request.accept()
        self.showFullScreen() if request.toggleOn() else self.showNormal()

    def closeEvent(self, event):
        self._closing = True
        self.timer.stop()
        self.shortcut_timer.stop()
        if self.login_view is not None:
            self.login_view.close()
        # Destroy pages before the profile, letting Qt flush persistent cookies on exit.
        for popup in getattr(self, '_popups', []):
            popup.close()
            popup.page().deleteLater()
        self.page.deleteLater()
        super().closeEvent(event)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--ipc')
    parser.add_argument('--profile', default=str(Path.home() / 'SpeakToSpeech' / 'media-browser'))
    parser.add_argument('--parent', type=int)
    parser.add_argument('--url', default='https://www.youtube.com/')
    args = parser.parse_args(argv)
    app = QApplication([sys.argv[0]])
    app.setApplicationName('SpeakToSpeech Media Browser')
    browser = MediaBrowser(args.profile)
    browser.show()
    if args.ipc:
        ipc = Path(args.ipc)
        sequence = -1

        def poll():
            nonlocal sequence
            if not ipc.exists() or (args.parent and not parent_alive(args.parent)):
                browser.close(); return
            try:
                command = json.loads((ipc / 'command.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                return
            if command.get('sequence') == sequence:
                return
            sequence = command.get('sequence')
            if command.get('action') == 'close':
                browser.close()
            elif command.get('action') == 'open':
                browser.open_url(command.get('url', ''))
        timer = QTimer(browser)
        timer.timeout.connect(poll)
        timer.start(150)
        poll()
        (ipc / 'ready').write_text('ready', encoding='utf-8')
    else:
        browser.open_url(args.url)
    result = app.exec()
    # Flush page deletion before destroying the profile (and its cookie store).
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    browser.profile.deleteLater()
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    return result


def parent_alive(pid):
    return psutil.pid_exists(pid)


if __name__ == '__main__':
    raise SystemExit(main())
