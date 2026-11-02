"""Open supported media links in the system browser, outside the app webview."""
import webbrowser
from media_browser_scripts import validate_media_url


def open_media_url(url):
    validate_media_url(url)
    if not webbrowser.open(url, new=2):
        raise RuntimeError("Could not open your browser. Copy the media link and open it manually.")
    return {"opened": True}
