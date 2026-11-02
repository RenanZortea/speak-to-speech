"""Navigation boundaries for the focused player and its separate login window."""
import re
from urllib.parse import parse_qs, urlsplit

VIDEO_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}
AUTH_HOSTS = {'accounts.google.com', 'consent.google.com', 'consent.youtube.com'}


def safe_https(url):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.username or parsed.password
                or parsed.port not in (None, 443) or '\\' in url
                or any(ord(char) <= 32 for char in url)):
            return None
        return parsed
    except (ValueError, TypeError):
        return None


def video_id(url):
    parsed = safe_https(url)
    if parsed and parsed.hostname in VIDEO_HOSTS and parsed.path == '/watch':
        query = parse_qs(parsed.query)
        values = query.get('v', [])
        if len(values) == 1 and re.fullmatch(r'[\w-]{11}', values[0], re.ASCII) and 'list' not in query:
            return values[0]
    raise ValueError('Load a YouTube video link to start practice.')


def practice_navigation_allowed(url, selected_id):
    try:
        return bool(selected_id) and video_id(url) == selected_id
    except ValueError:
        return False


def auth_navigation_allowed(url):
    parsed = safe_https(url)
    if not parsed:
        return False
    return (parsed.hostname in AUTH_HOSTS or
            parsed.hostname in VIDEO_HOSTS and parsed.path in {
                '/', '/watch', '/signin', '/signin/identifier', '/signin/v2/identifier',
                '/signin/v2/challenge/pwd', '/check_connection', '/sso', '/sso/redirect',
            })
