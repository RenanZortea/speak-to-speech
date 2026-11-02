import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from media_browser_scripts import validate_media_url, media_script
from media_browser_process import MediaBrowserProcess, browser_python


class MediaBrowserTests(unittest.TestCase):
    def setUp(self):
        patcher = patch('media_browser_process.browser_python', return_value=sys.executable)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_supported_https_sites_can_be_launched(self):
        for url in ['https://www.youtube.com/watch?v=test', 'https://www.youtube.com/results?search_query=hebrew',
                    'https://m.youtube.com/@channel', 'https://youtu.be/abc']:
            self.assertEqual(validate_media_url(url), url)
        for url in ['file:///etc/passwd', 'javascript:alert(1)', 'http://www.youtube.com/',
                    'https://youtube.com.evil.test/', 'https://youtube.com@evil.test/',
                    'https://user@www.youtube.com/', 'https://www.youtube.com:8000/', 'https://www.instagram.com/', 'https://open.spotify.com/']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_media_url(url)

    def test_playback_commands_are_validated(self):
        with self.assertRaises(ValueError):
            media_script('arbitrary-code')
        self.assertIn('media.currentTime', media_script('seek', -5))

    @patch('media_browser_process.subprocess.Popen')
    def test_reuses_window_and_sends_atomic_navigation_then_closes(self, popen):
        child = Mock()
        child.poll.return_value = None
        popen.return_value = child
        def start(command, **kwargs):
            ipc = Path(command[command.index('--ipc') + 1])
            (ipc / 'ready').write_text('ready')
            return child
        popen.side_effect = start
        with tempfile.TemporaryDirectory() as profile:
            manager = MediaBrowserProcess(profile)
            manager.open('https://www.youtube.com/')
            ipc = Path(manager._ipc.name)
            manager.open('https://www.youtube.com/playlist?list=PL123')
            self.assertEqual(popen.call_count, 1)
            message = json.loads((ipc / 'command.json').read_text())
            self.assertEqual(message['url'], 'https://www.youtube.com/playlist?list=PL123')
            manager.close()
            child.wait.assert_called_once_with(timeout=3)
            self.assertFalse(ipc.exists())

    @patch('media_browser_process.subprocess.Popen')
    def test_startup_failure_cleans_up_and_can_retry(self, popen):
        child = Mock()
        child.poll.return_value = 1
        popen.return_value = child
        with tempfile.TemporaryDirectory() as profile:
            manager = MediaBrowserProcess(profile)
            with self.assertRaisesRegex(RuntimeError, 'could not start'):
                manager.open('https://www.youtube.com/playlist?list=PL123')
            self.assertIsNone(manager._ipc)
            self.assertIsNone(manager._process)
            with self.assertRaisesRegex(RuntimeError, 'could not start'):
                manager.open('https://www.youtube.com/playlist?list=PL123')
            self.assertEqual(popen.call_count, 2)

    @patch('media_browser_process.subprocess.Popen')
    def test_invalid_url_never_starts_a_process(self, popen):
        manager = MediaBrowserProcess('/tmp/unused-media-browser-profile')
        with self.assertRaises(ValueError):
            manager.open('https://evil.test/')
        popen.assert_not_called()


class BrowserRuntimeTests(unittest.TestCase):
    @patch.dict('os.environ', {'SPEAKTOSPEECH_BROWSER_PYTHON': '/custom/python'})
    def test_explicit_runtime_is_respected(self):
        self.assertEqual(browser_python(), '/custom/python')

    @patch.dict('os.environ', {}, clear=True)
    @patch('media_browser_process.sys.platform', 'linux')
    @patch('media_browser_process.Path.exists', return_value=True)
    @patch('media_browser_process.subprocess.run')
    def test_system_qt_preferred_with_current_runtime_fallback(self, run, exists):
        run.return_value.returncode = 0
        self.assertEqual(browser_python(), '/usr/bin/python')
        run.return_value.returncode = 1
        self.assertEqual(browser_python(), sys.executable)
