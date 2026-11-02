"""Qt desktop shell: local React UI and a child media view in the same window."""
import argparse
import json
from pathlib import Path
import sys

from PySide6.QtCore import QFile, QIODevice, QObject, QTimer, QUrl, Qt, QEvent, Signal, Slot
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineScript, QWebEngineSettings, QWebEnginePermission
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow, QWidget

from media_browser import MediaBrowser, WORLD, parent_alive
from media_browser_scripts import media_script, validate_media_url

NATIVE_METHODS = ['open_media_browser', 'close_media_browser', 'set_media_bounds', 'media_command', 'media_sign_in']


class LocalPage(QWebEnginePage):
    def __init__(self, profile, origin, parent):
        super().__init__(profile, parent)
        self.origin = QUrl(origin)

    def acceptNavigationRequest(self, url, kind, main):
        return (url.scheme(), url.host(), url.port()) == (self.origin.scheme(), self.origin.host(), self.origin.port())


class Bridge(QObject):
    completed = Signal(str, str)

    def __init__(self, window, config):
        super().__init__(window)
        self.window = window
        self.config = config
        self.network = QNetworkAccessManager(self)
        self.polling = False
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(150)

    def request(self, path, value, callback):
        request = QNetworkRequest(QUrl(self.config['server'] + path))
        request.setRawHeader(b'Authorization', ('Bearer ' + self.config['token']).encode())
        request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
        request.setTransferTimeout(600000 if path == '/rpc' else 10000)
        reply = self.network.get(request) if value is None else self.network.post(request, json.dumps(value).encode())
        def finished():
            try:
                payload = json.loads(bytes(reply.readAll()).decode())
            except (ValueError, UnicodeError):
                payload = {'error': reply.errorString()}
            reply.deleteLater()
            callback(payload)
        reply.finished.connect(finished)

    @Slot(str, str, str)
    def call(self, request_id, method, encoded):
        try:
            args = json.loads(encoded)
            if method in NATIVE_METHODS:
                if method == 'media_command':
                    self.window.media.command(args[0], args[1] if len(args) > 1 else 0,
                        lambda state: self.completed.emit(request_id, json.dumps({'result': state})))
                    return
                elif method == 'media_sign_in':
                    self.window.media.sign_in()
                elif method == 'open_media_browser':
                    validate_media_url(args[0])
                    self.window.open_media(args[0])
                elif method == 'close_media_browser':
                    self.window.hide_media()
                else:
                    self.window.position_media(args[0])
                self.completed.emit(request_id, json.dumps({'result': {'opened': True}}))
            elif method in self.config['methods']:
                self.request('/rpc', {'method': method, 'args': args},
                             lambda response: self.completed.emit(request_id, json.dumps(response)))
            else:
                raise ValueError('Unknown method')
        except Exception as error:
            self.completed.emit(request_id, json.dumps({'error': str(error)}))

    def poll(self):
        if self.polling or not self.window.page_ready:
            return
        self.polling = True
        def received(events):
            self.polling = False
            if not isinstance(events, list):
                return
            for event in events:
                if event['kind'] == 'eval':
                    self.window.page.runJavaScript(event['script'])
                elif event['kind'] == 'close':
                    self.window.close()
                elif event['kind'] == 'dialog':
                    options = event.get('options', {})
                    filters = ';;'.join(options.get('file_types', ['All files (*.*)'])).replace(';*', ' *')
                    if event['type'] == 20:
                        selected = QFileDialog.getExistingDirectory(self.window, 'Choose folder')
                    elif event['type'] == 30:
                        selected, _ = QFileDialog.getSaveFileName(self.window, 'Save', options.get('save_filename', ''), filters)
                    else:
                        selected, _ = QFileDialog.getOpenFileName(self.window, 'Open audio', '', filters)
                    self.request('/ui-reply', {'id': event['id'], 'result': [selected] if selected else None}, lambda _: None)
        self.request('/events', None, received)


def bridge_script(methods):
    resource = QFile(':/qtwebchannel/qwebchannel.js')
    if not resource.open(QIODevice.OpenModeFlag.ReadOnly):
        raise RuntimeError('Qt WebChannel JavaScript is unavailable')
    library = bytes(resource.readAll()).decode()
    resource.close()
    return library + r'''
      new QWebChannel(qt.webChannelTransport, channel => {
        const native = channel.objects.bridge;
        const pending = new Map(); let sequence = 0;
        native.completed.connect((id, encoded) => {
          const task = pending.get(id); if (!task) return;
          pending.delete(id); const response = JSON.parse(encoded);
          if (response.error) task.reject(new Error(response.error)); else task.resolve(response.result);
        });
        const api = {};
        for (const method of METHODS) api[method] = (...args) => new Promise((resolve, reject) => {
          const id = String(++sequence); pending.set(id, {resolve, reject});
          native.call(id, method, JSON.stringify(args));
        });
        window.pywebview = {api, embeddedMedia: true};
        window.dispatchEvent(new Event('pywebviewready'));
      });
    '''.replace('METHODS', json.dumps(sorted(set(methods + NATIVE_METHODS))))


class DesktopWindow(QMainWindow):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.page_ready = False
        self.media_open = False
        self.bounds = None
        self.setWindowTitle('SpeakToSpeech')
        self.resize(1100, 850)
        self.setMinimumSize(700, 500)
        self.profile = QWebEngineProfile('SpeakToSpeechDesktop', self)
        self.profile.setPersistentStoragePath(str(Path(config['profile']) / 'desktop'))
        self.view = QWebEngineView(self)
        self.page = LocalPage(self.profile, config['url'], self.view)
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
        self.page.permissionRequested.connect(self.permission)
        self.channel = QWebChannel(self.page)
        self.bridge = Bridge(self, config)
        self.channel.registerObject('bridge', self.bridge)
        self.page.setWebChannel(self.channel)
        script = QWebEngineScript()
        script.setName('SpeakToSpeech desktop bridge')
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        script.setSourceCode(bridge_script(config['methods']))
        self.page.scripts().insert(script)
        self.clip = QWidget(self.view)
        self.media = MediaBrowser(Path(config['profile']) / 'media-browser', parent=self.clip, embedded=True)
        self.clip.hide()
        self.media.shortcutRequested.connect(self.practice_shortcut)
        self.page.loadStarted.connect(self.loading)
        self.page.loadFinished.connect(self.loaded)
        self.view.setUrl(QUrl(config['url']))

    def practice_shortcut(self, action):
        if self.page_ready and self.clip.isVisible() and self.media.login_view is None:
            self.page.runJavaScript("window.dispatchEvent(new CustomEvent('media-practice-shortcut', {detail:"
                                    + json.dumps(action) + "}));")

    def permission(self, permission):
        if permission.permissionType() in {QWebEnginePermission.PermissionType.MediaAudioCapture}:
            permission.grant()
        else:
            permission.deny()

    def loading(self):
        self.page_ready = False
        self.clip.hide()

    def loaded(self, ok):
        self.page_ready = ok

    def open_media(self, url):
        self.media_open = True
        self.media.open_url(url)
        if self.bounds:
            self.position_media(self.bounds)

    def hide_media(self):
        self.media_open = False
        self.media.page.runJavaScript(media_script('pause'), WORLD)
        self.clip.hide()

    def position_media(self, bounds):
        self.bounds = bounds
        visible = bool(bounds.get('visible')) and self.media_open and self.page_ready
        if not visible:
            if self.clip.isVisible():
                self.media.page.runJavaScript(media_script('pause'), WORLD)
            self.clip.hide()
            return
        zoom = self.view.zoomFactor()
        clip = bounds['clip']
        def number(value):
            return round(max(-100000, min(100000, float(value))) * zoom)
        self.clip.setGeometry(number(clip['x']), number(clip['y']), max(0, number(clip['width'])), max(0, number(clip['height'])))
        self.media.setGeometry(number(bounds['x'] - clip['x']), number(bounds['y'] - clip['y']),
                               max(0, number(bounds['width'])), max(0, number(bounds['height'])))
        self.media.show()
        self.clip.show()
        self.clip.raise_()

    def closeEvent(self, event):
        self.bridge.timer.stop()
        self.media.close()
        self.page.deleteLater()
        super().closeEvent(event)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args(argv)
    config = json.loads(Path(args.config).read_text(encoding='utf-8'))
    app = QApplication([sys.argv[0]])
    app.setApplicationName('SpeakToSpeech')
    window = DesktopWindow(config)
    window.show()
    timer = QTimer(window)
    timer.timeout.connect(lambda: None if parent_alive(config['parent']) else window.close())
    timer.start(1000)
    result = app.exec()
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    window.media.profile.deleteLater()
    window.profile.deleteLater()
    app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
