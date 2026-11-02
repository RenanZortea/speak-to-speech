import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from media_links import open_media_url


class MediaLinksTests(unittest.TestCase):
    @patch("media_links.webbrowser.open", return_value=True)
    def test_opens_supported_hosts(self, browser):
        for url in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/results?search_query=hebrew",
                    "https://youtu.be/abc?t=12"]:
            self.assertEqual(open_media_url(url), {"opened": True})
            browser.assert_called_with(url, new=2)

    @patch("media_links.webbrowser.open")
    def test_rejects_unsafe_targets_before_opening(self, browser):
        for url in ["file:///etc/passwd", "javascript:alert(1)", "https://www.youtube.com.evil.test/",
                    "https://www.youtube.com@evil.test/", "https://user@www.youtube.com/",
                    "https://www.instagram.com:8000/", "http://open.spotify.com/", "https://example.com/", "https://www.instagram.com/", "https://open.spotify.com/"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                open_media_url(url)
        browser.assert_not_called()

    @patch("media_links.webbrowser.open", return_value=False)
    def test_reports_browser_failure(self, browser):
        with self.assertRaisesRegex(RuntimeError, "Could not open"):
            open_media_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
