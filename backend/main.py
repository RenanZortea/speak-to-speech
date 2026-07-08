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

# Linux + NVIDIA proprietary driver: WebKitGTK's DMA-BUF renderer crashes the
# window with "Error 71 (Protocol error) dispatching to Wayland display"
# (known WebKitGTK/NVIDIA bug, same one Tauri apps hit). Disable it before the
# webview module spawns WebKit's processes. setdefault so users can override.
import sys
if sys.platform == "linux" and os.path.exists("/proc/driver/nvidia"):
    os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")

import json
import threading
from pathlib import Path

import app_settings
# Point the Hugging Face hub cache at the user-chosen models dir before any HF
# import reads it. Explicit cache_dir/download_root args (below) handle runtime
# changes; this env var just covers any default-cache code path we don't pass.
os.environ["HF_HUB_CACHE"] = str(app_settings.get_models_dir())

import webview

from audio_server import AudioServer
from model_manager import (
    DEFAULT_LANGUAGE,
    DEFAULT_MODEL_ID,
    cancel_download as mm_cancel_download,
    delete_model as mm_delete_model,
    download_model as mm_download_model,
    gpu_info,
    has_ct2_weights,
    is_model_present,
    languages_payload,
    list_models,
)
from orchestration import JobLane, ResourceManager
from pronunciation import PRON_MODEL_ID, PronunciationWorker
from resources import ResourceMonitor
from session_store import DEFAULT_BASE, SessionStore
from worker import WhisperWorker

DEV_URL = "http://localhost:5173"


def _model_usable(model_id: str) -> bool:
    """True iff a Whisper model is both downloaded and loadable by faster-whisper
    (CTranslate2 weights present). Guards against selecting a Transformers-format
    repo that's on disk but crashes transcription."""
    return is_model_present(model_id) and has_ct2_weights(model_id)

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
        self._resources = ResourceManager()
        self._worker = WhisperWorker(resource_manager=self._resources)
        self._pron = PronunciationWorker()
        self._jobs = JobLane(on_state=self._on_job_state)
        self._audio = AudioServer()
        self._audio.start()
        self._sessions = SessionStore()
        self._monitor = ResourceMonitor(emit=lambda s: self._emit("resource_stats", s))
        self._window = None
        # Active selection — persisted across restarts (see app_settings). Falls
        # back to the Hebrew default, and if that isn't downloaded but some other
        # catalog model is, to that — so we don't nag "install the default model"
        # when a usable model is already present and selected.
        self._active_model_id = self._resolve_active_model()
        self._active_language = app_settings.get_active_language() or DEFAULT_LANGUAGE
        # Resource settings.
        import os as _os
        self._cpu_threads = max(1, (_os.cpu_count() or 4) // 2)
        self._release_when_idle = False

    def _resolve_active_model(self) -> str:
        """Pick the model to treat as active at startup. Prefer the persisted
        selection if it's usable; else the default; else any usable model."""
        saved = app_settings.get_active_model()
        if saved and _model_usable(saved):
            return saved
        if _model_usable(DEFAULT_MODEL_ID):
            return DEFAULT_MODEL_ID
        # Default isn't usable/downloaded — fall back to any *usable* model so we
        # don't nag "install the default" when a working one exists. "usable" =
        # loadable by faster-whisper (CTranslate2), not merely present on disk:
        # a Transformers-format repo is present but crashes transcription.
        usable = [m for m in list_models() if m.get("usable")]
        usable.sort(key=lambda m: m.get("type") == "custom")  # catalog before custom
        if usable:
            return usable[0]["id"]
        return saved or DEFAULT_MODEL_ID

    def _on_job_state(self, job_name):
        """JobLane state callback → single busy/idle signal to the UI."""
        self._emit("job_state", {"busy": job_name is not None, "job": job_name})

    # Methods prefixed with `_` are not exposed to JS by pywebview.
    def _set_window(self, window):
        self._window = window
        self._monitor.start()

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
        # `present` here means "ready to transcribe" — downloaded AND a valid
        # CTranslate2 model. A Transformers-format repo is on disk but unusable,
        # so it must read as not-ready (→ the UI prompts to get a real model).
        return {
            "active_model_id": self._active_model_id,
            "active_language": self._active_language,
            "present": _model_usable(self._active_model_id),
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
        app_settings.set_active_model(model_id)
        return {"active_model_id": self._active_model_id}

    def set_active_language(self, language: str):
        self._active_language = language
        app_settings.set_active_language(language)
        return {"active_language": self._active_language}

    def preload_model(self, model_id: str | None = None):
        """Load a model into VRAM in the background (no transcription)."""
        target = model_id or self._active_model_id
        if not is_model_present(target):
            return {"error": "not_downloaded", "model_id": target}
        if not has_ct2_weights(target):
            return {"error": "not_ct2", "model_id": target}

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

    # ---- Pronunciation ----

    def check_pron_model(self):
        return {
            "model_id": PRON_MODEL_ID,
            "present": is_model_present(PRON_MODEL_ID),
            "loaded": self._pron.is_loaded,
        }

    def download_pron_model(self):
        def run():
            mm_download_model(PRON_MODEL_ID, lambda p: self._emit("pron_model_download", p))
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model_id": PRON_MODEL_ID}

    def cancel_pron_download(self):
        ok = mm_cancel_download(PRON_MODEL_ID)
        return {"cancelled": ok}

    def assess_pronunciation(self, audio_path: str):
        def job():
            self._pron.assess(
                audio_path,
                on_done=lambda d: self._emit("pron_status", {"status": "done", **d}),
                on_error=lambda err: self._emit("pron_status", {"status": "error", "error": err}),
                on_status=lambda s: self._emit("pron_status", s),
            )

        def run():
            ok = self._jobs.try_run("pronunciation", job)
            if ok and self._release_when_idle:
                self._pron.unload()
            elif not ok:
                self._emit("pron_status", {
                    "status": "error",
                    "error": f"Busy with '{self._jobs.current}' — wait for it to finish.",
                })
        threading.Thread(target=run, daemon=True).start()
        return {"started": True}

    # ---- Sessions (persistence) ----

    def save_session(self, data: dict):
        return self._sessions.save_session(data or {})

    def update_session(self, session_id: str, data: dict):
        return self._sessions.update_session(session_id, data or {})

    def list_sessions(self):
        return self._sessions.list_sessions()

    def load_session(self, session_id: str):
        sess = self._sessions.load_session(session_id)
        if sess is None:
            return None
        # Point the audio server at the stored file so it can be played back.
        stored = sess.get("audio_stored_path")
        if stored and os.path.isfile(stored):
            self._audio.set_audio(stored)
            sess["audio_url"] = self._audio.url
        else:
            sess["audio_url"] = None
        return sess

    def rename_session(self, session_id: str, title: str):
        return {"ok": self._sessions.rename_session(session_id, title)}

    def delete_session(self, session_id: str):
        return {"ok": self._sessions.delete_session(session_id)}

    # ---- Resources / settings ----

    def get_settings(self):
        import os as _os
        from version import __version__
        return {
            "version": __version__,
            "cpu_threads": self._cpu_threads,
            "cpu_count": _os.cpu_count() or 4,
            "release_when_idle": self._release_when_idle,
            "whisper_loaded": self._worker.is_loaded,
            "pron_loaded": self._pron.is_loaded,
            "models_dir": str(app_settings.get_models_dir()),
            "models_dir_custom": app_settings.is_models_dir_custom(),
        }

    def choose_models_dir(self):
        """Open a native folder picker and persist the chosen models dir.
        Returns {"models_dir": str, "changed": bool}. New downloads and model
        loads use it immediately; models already downloaded elsewhere stay put."""
        if not self._window:
            return None
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return {"models_dir": str(app_settings.get_models_dir()), "changed": False}
        path = result if isinstance(result, str) else result[0]
        new = app_settings.set_models_dir(path)
        os.environ["HF_HUB_CACHE"] = str(new)
        return {"models_dir": str(new), "changed": True}

    def reset_models_dir(self):
        """Reset the models dir back to the Hugging Face default location."""
        new = app_settings.set_models_dir(None)
        os.environ["HF_HUB_CACHE"] = str(new)
        return {"models_dir": str(new), "changed": True}

    def set_cpu_threads(self, n: int):
        import os as _os
        n = max(1, min(int(n), _os.cpu_count() or 4))
        self._cpu_threads = n
        self._pron.cpu_threads = n
        # Apply immediately if torch is already imported.
        if "torch" in sys.modules:
            try:
                sys.modules["torch"].set_num_threads(n)
            except Exception:
                pass
        return {"cpu_threads": n}

    def set_release_when_idle(self, enabled: bool):
        self._release_when_idle = bool(enabled)
        return {"release_when_idle": self._release_when_idle}

    def unload_all_models(self):
        self._worker.unload()
        self._pron.unload()
        return {"whisper_loaded": self._worker.is_loaded, "pron_loaded": self._pron.is_loaded}

    # ---- Updates ----

    def check_for_update(self):
        from updater import check_for_update
        return check_for_update()

    def install_update(self, url: str):
        """Download the installer and launch it; the app then exits so files can
        be replaced. Emits 'update_download' progress events."""
        from updater import download_and_run_installer

        def run():
            res = download_and_run_installer(
                url, on_progress=lambda p: self._emit("update_download", p)
            )
            if res.get("error"):
                self._emit("update_download", {"status": "error", "error": res["error"]})
            elif res.get("launched"):
                self._emit("update_download", {"status": "launching"})
                # Give the installer a moment to start, then close this app.
                import time
                time.sleep(1.5)
                try:
                    if self._window:
                        self._window.destroy()
                except Exception:
                    pass
                os._exit(0)
            else:
                self._emit("update_download", {"status": "manual", "path": res.get("path")})

        threading.Thread(target=run, daemon=True).start()
        return {"started": True}
        return {"started": True}

    # ---- Ollama (local LLM corrections) ----

    def ollama_list_models(self):
        """List models installed in the user's local Ollama daemon.

        The daemon is the user's responsibility to run; we only talk to it.
        Returns {"url", "models", "selected"} on success, or {"error"} if it's
        unreachable so the UI can fall back to the copy/paste flow.
        """
        from ollama_client import OllamaError, list_models
        url = app_settings.get_ollama_url()
        try:
            models = list_models(url)
        except OllamaError as e:
            return {"error": str(e), "url": url, "models": []}
        selected = app_settings.get_ollama_model()
        if selected not in models:
            selected = models[0] if models else None
        return {"url": url, "models": models, "selected": selected}

    def set_ollama_model(self, model: str):
        return {"selected": app_settings.set_ollama_model(model)}

    def ollama_correct(self, prompt: str, model: str):
        """Generate corrections with a local Ollama model. Async — the raw JSON
        text comes back via the 'ollama_status' event (done/error). The frontend
        maps it onto the transcript with the same parser as the paste flow.

        VRAM safety: this goes through the JobLane (so it can't run while a
        transcribe/pronounce job holds the GPU), and we unload our own GPU model
        before generating. Ollama is asked to unload right after (keep_alive=0).
        Net effect on a small card: at most one big model resident at a time."""
        from ollama_client import OllamaError, generate
        url = app_settings.get_ollama_url()
        app_settings.set_ollama_model(model)

        def job():
            self._emit("ollama_status", {"status": "generating", "model": model})
            # Free VRAM so Ollama's model doesn't load on top of Whisper.
            self._worker.unload()
            self._pron.unload()
            try:
                text = generate(url, model, prompt, keep_alive=0)
                self._emit("ollama_status", {"status": "done", "text": text})
            except OllamaError as e:
                self._emit("ollama_status", {"status": "error", "error": str(e)})
            except Exception as e:
                self._emit("ollama_status", {"status": "error", "error": str(e)})

        def run():
            ok = self._jobs.try_run("ai_correction", job)
            if not ok:
                self._emit("ollama_status", {
                    "status": "error",
                    "error": f"Busy with '{self._jobs.current}' - wait for it to finish.",
                })
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model": model}

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

        def job():
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

        def run():
            ok = self._jobs.try_run("transcribe", job)
            if ok and self._release_when_idle:
                self._worker.unload()
            elif not ok:
                self._emit("transcribe_status", {
                    "status": "error",
                    "error": f"Busy with '{self._jobs.current}' — wait for it to finish.",
                })
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
    if sys.platform == "linux":
        _grant_media_permissions_linux(window)
    # private_mode defaults to True; on the GTK backend that sets WebKit's
    # enable-html5-local-storage=False, which removes window.localStorage from
    # JS entirely ("ReferenceError: Can't find variable: localStorage" in
    # App.tsx). WebView2 on Windows keeps localStorage in private mode, so
    # this only bites on Linux. private_mode=False also makes storage_path
    # take effect (private mode short-circuits to an ephemeral context).
    webview.start(
        debug=dev,
        private_mode=False,
        storage_path=str(DEFAULT_BASE / "webview"),
    )


def _grant_media_permissions_linux(window):
    """Auto-grant getUserMedia (mic) on the WebKitGTK backend.

    On Windows, WebView2's ``--use-fake-ui-for-media-stream`` browser arg silently
    grants mic access. WebKitGTK has no equivalent: ``enable_media_stream`` is on,
    but WebKit *denies* every permission request unless a ``permission-request``
    handler is connected, so ``getUserMedia`` fails and recording never starts.
    Connect the signal (once the webview exists, on ``shown``) and allow media
    requests. Safe for a local single-user tool; do not ship in a multi-user app."""
    def on_shown():
        try:
            from webview.platforms.gtk import BrowserView
            from gi.repository import WebKit2
            view = BrowserView.instances.get(window.uid)
            if view is None:
                return

            def on_permission(_webview, request):
                if isinstance(request, WebKit2.UserMediaPermissionRequest):
                    request.allow()
                    return True
                return False

            view.webview.connect("permission-request", on_permission)
        except Exception as e:
            print(f"mic permission hook failed: {e}", file=sys.stderr)

    window.events.shown += on_shown


def _setup_frozen_logging():
    """In a windowed PyInstaller bundle there's no stdout/stderr. Redirect
    them to a log file under %TEMP% so launch errors are recoverable."""
    import tempfile
    log_path = Path(tempfile.gettempdir()) / "SpeakToSpeech-launch.log"
    try:
        f = open(log_path, "w", encoding="utf-8", buffering=1)
        sys.stdout = f
        sys.stderr = f
        print(f"SpeakToSpeech launching - log {log_path}")
    except Exception:
        pass


def _selftest():
    """Verify the bundled pronunciation stack: import torch/transformers, load
    the model from cache, and run a tiny inference. Writes PASS/FAIL to the log.
    Triggered with --selftest; used to validate the frozen build."""
    import numpy as np

    def step(name, fn):
        try:
            fn()
            print(f"PASS  {name}", flush=True)
            return True
        except Exception as e:
            print(f"FAIL  {name}: {type(e).__name__}: {e}", flush=True)
            return False

    print("=== pronunciation self-test ===", flush=True)
    ok = True
    ok &= step("import torch", lambda: __import__("torch"))
    ok &= step("import transformers", lambda: __import__("transformers"))
    ok &= step("import soundfile", lambda: __import__("soundfile"))

    from pronunciation import PronunciationWorker
    worker = PronunciationWorker()
    ok &= step("load model", worker.load)

    def infer():
        import torch
        # 1 second of quiet noise at 16kHz — exercises the full torch path.
        audio = (np.random.randn(16000) * 0.01).astype("float32")
        inputs = worker._fe(audio, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = worker._model(inputs.input_values).logits
        assert logits.shape[-1] > 0

    ok &= step("run inference", infer)
    print("=== self-test", "PASSED" if ok else "FAILED", "===", flush=True)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    # multiprocessing spawn (used by model_manager for cancellable downloads) will
    # re-import this module in the child process. freeze_support() is a no-op in
    # dev but is the canonical guard against the child re-running main().
    import multiprocessing
    multiprocessing.freeze_support()

    if getattr(sys, "frozen", False):
        _setup_frozen_logging()
        try:
            if "--selftest" in sys.argv:
                _selftest()
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
