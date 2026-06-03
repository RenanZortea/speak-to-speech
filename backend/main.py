"""
SpeakToSpeech — pywebview entry point.

Run dev (Vite at :5173 must be running):
    python backend/main.py --dev

Run prod (frontend built into frontend/dist):
    python backend/main.py

Use your project venv's Python (the one with faster-whisper installed).
"""
import os
# Auto-grant getUserMedia (mic) in WebView2 without showing a permission prompt.
# Must be set BEFORE the webview module triggers WebView2 init.
# Safe for a local single-user tool; do not ship in a multi-user/public app.
os.environ.setdefault(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required",
)

import json
import sys
import threading
from pathlib import Path

import webview

from audio_server import AudioServer
from model_manager import (
    DEFAULT_LANGUAGE,
    DEFAULT_MODEL_ID,
    cancel_download as mm_cancel_download,
    delete_model as mm_delete_model,
    download_model as mm_download_model,
    gpu_info,
    is_model_present,
    languages_payload,
    list_models,
)
from worker import WhisperWorker

DEV_URL = "http://localhost:5173"

# Resolve the production index:
#   - Bundled (PyInstaller): under sys._MEIPASS/frontend/dist/
#   - Dev: relative to this file at the project root.
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    PROD_INDEX = Path(sys._MEIPASS) / "frontend" / "dist" / "index.html"
else:
    PROD_INDEX = Path(__file__).resolve().parent.parent / "frontend" / "dist" / "index.html"


class Api:
    """Exposed to JS as `window.pywebview.api.<method>`."""

    def __init__(self):
        self._worker = WhisperWorker()
        self._audio = AudioServer()
        self._audio.start()
        self._window = None
        # Active selection — Hebrew by default. Persists across transcribes.
        self._active_model_id = DEFAULT_MODEL_ID
        self._active_language = DEFAULT_LANGUAGE

    # Methods prefixed with `_` are not exposed to JS by pywebview.
    def _set_window(self, window):
        self._window = window

    def _emit(self, event: str, payload):
        if self._window is None:
            return
        js = f"window.__emit({json.dumps(event)}, {json.dumps(payload)})"
        try:
            self._window.evaluate_js(js)
        except Exception:
            pass  # window closing, etc.

    # ---- JS-exposed ----

    def check_model(self):
        return {
            "active_model_id": self._active_model_id,
            "active_language": self._active_language,
            "present": is_model_present(self._active_model_id),
            "model_loaded": self._worker.is_loaded,
            "current_model_id": self._worker.current_id,
            "gpu": gpu_info(),
        }

    def list_models(self):
        """Catalog + presence + size_on_disk + active flag for the UI's model manager."""
        return [
            {**m, "active": m["id"] == self._active_model_id}
            for m in list_models()
        ]

    def get_languages(self):
        return languages_payload()

    def set_active_model(self, model_id: str):
        self._active_model_id = model_id
        return {"active_model_id": self._active_model_id}

    def set_active_language(self, language: str):
        self._active_language = language
        return {"active_language": self._active_language}

    def preload_model(self, model_id: str | None = None):
        """Load a model into VRAM in the background (no transcription)."""
        target = model_id or self._active_model_id
        if not is_model_present(target):
            return {"error": "not_downloaded", "model_id": target}

        def run():
            try:
                self._emit("model_load_status", {"status": "loading", "model_id": target})
                self._worker.load(target)
                self._emit("model_load_status", {"status": "loaded", "model_id": target})
            except Exception as e:
                self._emit("model_load_status", {"status": "error", "model_id": target, "error": str(e)})
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model_id": target}

    def get_server_url(self):
        """Base URL of the local audio server, e.g. http://127.0.0.1:54321."""
        return self._audio.base_url

    def download_model(self, model_id: str | None = None):
        target = model_id or self._active_model_id

        def run():
            mm_download_model(target, lambda p: self._emit("model_download", p))
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model_id": target}

    def delete_model(self, model_id: str):
        # If we're about to delete the model currently loaded in VRAM, unload it first.
        if self._worker.current_id == model_id:
            self._worker.unload()
        ok = mm_delete_model(model_id)
        return {"deleted": ok, "model_id": model_id}

    def cancel_download(self, model_id: str):
        """Cancel an in-progress download. Safe to call when no download is active."""
        ok = mm_cancel_download(model_id)
        return {"cancelled": ok, "model_id": model_id}

    def save_text(self, content: str, default_name: str = "transcript.txt"):
        """Open native save dialog; write UTF-8 content; return saved path or None."""
        if not self._window:
            return None
        ext = default_name.rsplit(".", 1)[-1].lower() if "." in default_name else "txt"
        file_types = (
            f"{ext.upper()} files (*.{ext})",
            "All files (*.*)",
        )
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=default_name,
            file_types=file_types,
        )
        if not result:
            return None
        path = result if isinstance(result, str) else result[0]
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return path

    def pick_audio_file(self):
        if not self._window:
            return None
        file_types = (
            "Audio files (*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.opus;*.aac;*.wma)",
            "All files (*.*)",
        )
        files = self._window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types
        )
        if not files:
            return None
        path = files[0]
        self._audio.set_audio(path)
        return {"path": path, "url": self._audio.url}

    def transcribe(self, audio_path: str, options: dict | None = None):
        opts = options or {}
        temperature = float(opts.get("temperature", 0.0))
        model_id = opts.get("model_id") or self._active_model_id
        language_raw = opts.get("language") or self._active_language
        # "auto" → None (autodetect); otherwise pass the code through to Whisper.
        language = None if language_raw == "auto" else language_raw

        # Persist these as the active selection.
        self._active_model_id = model_id
        self._active_language = language_raw

        def run():
            self._worker.transcribe(
                audio_path,
                on_segment=lambda s: self._emit("segment", s),
                on_done=lambda meta: self._emit("transcribe_status", {"status": "done", **meta}),
                on_error=lambda err: self._emit("transcribe_status", {"status": "error", "error": err}),
                on_status=lambda s: self._emit("transcribe_status", s),
                model_id=model_id,
                temperature=temperature,
                language=language,
            )
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model_id": model_id, "language": language_raw}


def main():
    dev = "--dev" in sys.argv
    if dev:
        url = DEV_URL
    else:
        if not PROD_INDEX.exists():
            print(f"Frontend not built. Expected: {PROD_INDEX}", file=sys.stderr)
            print("Run: cd frontend && npm run build", file=sys.stderr)
            sys.exit(2)
        url = str(PROD_INDEX)

    api = Api()
    window = webview.create_window(
        "SpeakToSpeech",
        url=url,
        js_api=api,
        width=1100,
        height=800,
        min_size=(700, 500),
    )
    api._set_window(window)
    webview.start(debug=dev)


def _setup_frozen_logging():
    """In a windowed PyInstaller bundle there's no stdout/stderr. Redirect
    them to a log file under %TEMP% so launch errors are recoverable."""
    import tempfile
    log_path = Path(tempfile.gettempdir()) / "SpeakToSpeech-launch.log"
    try:
        f = open(log_path, "w", encoding="utf-8", buffering=1)
        sys.stdout = f
        sys.stderr = f
        print(f"SpeakToSpeech launching — log {log_path}")
    except Exception:
        pass


if __name__ == "__main__":
    # multiprocessing spawn (used by model_manager for cancellable downloads) will
    # re-import this module in the child process. freeze_support() is a no-op in
    # dev but is the canonical guard against the child re-running main().
    import multiprocessing
    multiprocessing.freeze_support()

    if getattr(sys, "frozen", False):
        _setup_frozen_logging()
        try:
            main()
        except SystemExit:
            raise
        except BaseException:
            import traceback
            traceback.print_exc()
            try:
                sys.stdout.flush()
            except Exception:
                pass
            raise
    else:
        main()
