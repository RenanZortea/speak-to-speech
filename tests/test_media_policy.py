import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from media_policy import video_id, practice_navigation_allowed, auth_navigation_allowed

VIDEO = 'dQw4w9WgXcQ'
class MediaPolicyTests(unittest.TestCase):
    def test_video_launch_requires_a_single_video(self):
        self.assertEqual(video_id('https://www.youtube.com/watch?v=' + VIDEO + '&t=12s'), VIDEO)
        for url in ['https://www.youtube.com/', 'https://www.youtube.com/results?q=test',
                    'https://www.youtube.com/watch?v=bad', 'https://evil.test/watch?v=' + VIDEO,
                    'https://user@www.youtube.com/watch?v=' + VIDEO]:
            with self.subTest(url=url), self.assertRaises(ValueError): video_id(url)

    def test_practice_cannot_leave_selected_video(self):
        self.assertTrue(practice_navigation_allowed('https://www.youtube.com/watch?v=' + VIDEO, VIDEO))
        for url in ['https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/',
                    'https://example.com/', 'https://accounts.google.com/', 'file:///tmp/test',
                    'https://www.youtube.com/watch?v=' + VIDEO + '&list=PL123']:
            self.assertFalse(practice_navigation_allowed(url, VIDEO), url)

    def test_login_is_limited_to_authentication_hosts_and_paths(self):
        for url in ['https://accounts.google.com/ServiceLogin', 'https://consent.google.com/m',
                    'https://consent.youtube.com/m', 'https://www.youtube.com/signin',
                    'https://www.youtube.com/', 'https://www.youtube.com/watch?v=' + VIDEO]:
            self.assertTrue(auth_navigation_allowed(url), url)
        for url in ['https://accounts.google.com.evil.test/', 'https://google.com/search',
                    'https://www.youtube.com/results?search_query=test', 'https://example.com/',
                    'https://user@accounts.google.com/', 'http://accounts.google.com/',
                    'https://accounts.google.com:8000/', 'javascript:alert(1)']:
            self.assertFalse(auth_navigation_allowed(url), url)
