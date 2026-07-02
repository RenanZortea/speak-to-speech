"""
Update check via the GitHub Releases API (approach A: assisted install).

check_for_update() compares the running version against the latest GitHub
release tag. If newer, the UI offers to download the Setup.exe asset and run it;
the per-user Inno Setup installer updates in place and the app relaunches.

No third-party updater framework, no appcast hosting — GitHub Releases is the
source of truth.
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

from version import GITHUB_REPO, __version__

_API_LATEST = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _parse_semver(v: str) -> tuple:
    v = v.strip().lstrip("vV")
    parts = []
    for chunk in v.split(".")[:3]:
        num = ""
        for ch in chunk:
            if ch.isdigit():
                num += ch
            else:
                break
        parts.append(int(num) if num else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def _is_newer(latest: str, current: str) -> bool:
    return _parse_semver(latest) > _parse_semver(current)


def check_for_update(timeout: float = 6.0) -> dict:
    """Query GitHub for the latest release. Returns a dict the UI can render."""
    result = {"update_available": False, "current_version": __version__}
    try:
        req = urllib.request.Request(
            _API_LATEST,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "SpeakToSpeech-Updater",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tag = data.get("tag_name", "")
        result["latest_version"] = tag.lstrip("vV")
        result["notes"] = data.get("body", "")
        result["html_url"] = data.get("html_url")

        # Find the Setup.exe asset (fall back to the first .exe, then the zip).
        assets = data.get("assets", []) or []
        setup = next((a for a in assets if "setup" in a["name"].lower() and a["name"].lower().endswith(".exe")), None)
        if setup is None:
            setup = next((a for a in assets if a["name"].lower().endswith(".exe")), None)
        if setup is None:
            setup = next((a for a in assets if a["name"].lower().endswith(".zip")), None)
        if setup is not None:
            result["download_url"] = setup["browser_download_url"]
            result["asset_name"] = setup["name"]

        result["update_available"] = bool(tag) and _is_newer(tag, __version__)
    except Exception as e:
        result["error"] = str(e)
    return result


def download_and_run_installer(url: str, on_progress=None) -> dict:
    """Download the installer to %TEMP% and launch it, then signal the app to exit.
    Returns {"launched": True, "path": ...} or {"error": ...}."""
    if sys.platform != "win32":
        # Release assets are Windows installers; running from source elsewhere.
        return {"error": "Self-update is Windows-only. Update with: git pull && cd frontend && npm run build"}
    try:
        name = url.split("/")[-1] or "SpeakToSpeech-Setup.exe"
        dest = os.path.join(tempfile.gettempdir(), name)

        req = urllib.request.Request(url, headers={"User-Agent": "SpeakToSpeech-Updater"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            total = int(resp.headers.get("Content-Length", 0) or 0)
            got = 0
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    if on_progress:
                        on_progress({"bytes": got, "total": total})

        if dest.lower().endswith(".exe"):
            # Launch the installer detached; it will close this app (Inno
            # CloseApplications) and replace files, then relaunch.
            subprocess.Popen([dest], close_fds=True)
            return {"launched": True, "path": dest}
        else:
            # A zip — just reveal it; user updates manually.
            os.startfile(os.path.dirname(dest))  # type: ignore[attr-defined]
            return {"launched": False, "path": dest, "manual": True}
    except Exception as e:
        return {"error": str(e)}
