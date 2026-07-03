"""
Catalog of available Whisper models + HF cache management.

The CATALOG is the source of truth for what's selectable in the UI.
Each entry is a plain dict; presence/size on disk are computed at query time.
"""
import multiprocessing as mp
import shutil
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from app_settings import get_models_dir
from pronunciation import PRON_MODEL_ID

DEFAULT_MODEL_ID = "ivrit-ai/whisper-large-v3-ct2"
DEFAULT_LANGUAGE = "he"

# Built-in catalog. Add entries here to expose them in the UI's model manager.
CATALOG: list[dict] = [
    {
        "id": "ivrit-ai/whisper-large-v3-ct2",
        "name": "Whisper Large v3 — Hebrew",
        "publisher": "ivrit-ai",
        "languages": ["he"],
        "size_bytes": 3_000_000_000,
        "type": "fine-tune",
        "description": "Fine-tuned for Hebrew speech (Knesset, podcasts). Best Hebrew accuracy.",
        "default": True,
    },
    {
        "id": "Systran/faster-whisper-large-v3",
        "name": "Whisper Large v3",
        "publisher": "Systran",
        "languages": ["multilingual"],
        "size_bytes": 3_100_000_000,
        "type": "official",
        "description": "Official Whisper large v3. 99 languages. Best general-purpose accuracy.",
    },
    {
        "id": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "name": "Whisper Large v3 Turbo",
        "publisher": "Mobius Labs",
        "languages": ["multilingual"],
        "size_bytes": 1_620_000_000,
        "type": "official",
        "description": "v3 Turbo — ~4× faster than large-v3, nearly the same quality.",
    },
    {
        "id": "Systran/faster-whisper-medium",
        "name": "Whisper Medium",
        "publisher": "Systran",
        "languages": ["multilingual"],
        "size_bytes": 1_500_000_000,
        "type": "official",
        "description": "Smaller than large. Faster, decent quality for most languages.",
    },
    {
        "id": "Systran/faster-whisper-small",
        "name": "Whisper Small",
        "publisher": "Systran",
        "languages": ["multilingual"],
        "size_bytes": 470_000_000,
        "type": "official",
        "description": "Fast, lower quality. Good for quick testing.",
    },
    {
        "id": "Systran/faster-whisper-tiny",
        "name": "Whisper Tiny",
        "publisher": "Systran",
        "languages": ["multilingual"],
        "size_bytes": 75_000_000,
        "type": "official",
        "description": "Smallest. Useful only for quick drafts.",
    },
]

# Curated common languages. faster-whisper supports ~99 total via Whisper.
# This is the high-frequency subset surfaced in the dropdown.
LANGUAGES: list[tuple[str, str]] = [
    ("auto", "Auto-detect"),
    ("he", "Hebrew"),
    ("en", "English"),
    ("es", "Spanish"),
    ("pt", "Portuguese"),
    ("fr", "French"),
    ("de", "German"),
    ("it", "Italian"),
    ("ar", "Arabic"),
    ("ru", "Russian"),
    ("zh", "Chinese"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
    ("hi", "Hindi"),
    ("sv", "Swedish"),
    ("no", "Norwegian"),
    ("da", "Danish"),
    ("fi", "Finnish"),
    ("el", "Greek"),
    ("cs", "Czech"),
    ("ro", "Romanian"),
    ("hu", "Hungarian"),
    ("th", "Thai"),
    ("vi", "Vietnamese"),
    ("id", "Indonesian"),
    ("ca", "Catalan"),
]


# ----- HF cache helpers -----

def _hub_dir() -> Path:
    """The Hugging Face hub cache dir models live in (user-configurable)."""
    return get_models_dir()


def _cache_dir(model_id: str) -> Path:
    name = "models--" + model_id.replace("/", "--")
    return _hub_dir() / name


def _dir_size(p: Path) -> int:
    try:
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    except Exception:
        return 0


def _expected_size(model_id: str) -> int:
    for m in CATALOG:
        if m["id"] == model_id:
            return m["size_bytes"]
    return 50_000_000  # safe floor for unknown / custom models


def is_model_present(model_id: str) -> bool:
    """A model is considered present if its cache dir is at least half of expected size."""
    expected = _expected_size(model_id)
    threshold = max(50_000_000, expected // 2)
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir(cache_dir=_hub_dir())
        for repo in info.repos:
            if repo.repo_id == model_id and repo.size_on_disk > threshold:
                return True
        return False
    except Exception:
        return _dir_size(_cache_dir(model_id)) > threshold


def model_size_on_disk(model_id: str) -> int:
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir(cache_dir=_hub_dir())
        for repo in info.repos:
            if repo.repo_id == model_id:
                return repo.size_on_disk
        return 0
    except Exception:
        return _dir_size(_cache_dir(model_id))


def _scan_repo_sizes() -> dict[str, int]:
    """One pass over the HF cache: model repo_id -> size_on_disk."""
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir(cache_dir=_hub_dir())
        return {
            r.repo_id: r.size_on_disk
            for r in info.repos
            if getattr(r, "repo_type", "model") == "model"
        }
    except Exception:
        out: dict[str, int] = {}
        for d in _hub_dir().glob("models--*"):
            repo_id = d.name[len("models--"):].replace("--", "/", 1)
            out[repo_id] = _dir_size(d)
        return out


def list_models() -> list[dict]:
    """CATALOG + presence/size, then any cached repo not in the CATALOG as a
    'custom' entry — otherwise models downloaded by custom HF repo ID would
    never show up (and so could never be selected)."""
    sizes = _scan_repo_sizes()

    def present(model_id: str, expected: int) -> bool:
        return sizes.get(model_id, 0) > max(50_000_000, expected // 2)

    out = [
        {
            **m,
            "present": present(m["id"], m["size_bytes"]),
            "size_on_disk": sizes.get(m["id"], 0),
        }
        for m in CATALOG
    ]

    known = {m["id"] for m in CATALOG}
    for repo_id in sorted(sizes):
        # The pronunciation model shares this cache; it isn't a Whisper model.
        if repo_id in known or repo_id == PRON_MODEL_ID:
            continue
        size = sizes[repo_id]
        org, _, name = repo_id.partition("/")
        out.append({
            "id": repo_id,
            "name": name or repo_id,
            "publisher": org,
            "languages": ["custom"],
            "size_bytes": size,
            "type": "custom",
            "description": "Downloaded by HF repo ID. Must be a CTranslate2 (faster-whisper) conversion.",
            "present": present(repo_id, size),
            "size_on_disk": size,
        })
    return out


def delete_model(model_id: str) -> bool:
    """Remove a model's files from the HF cache. Returns True if anything was removed."""
    removed = False
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir(cache_dir=_hub_dir())
        for repo in info.repos:
            if repo.repo_id == model_id:
                shutil.rmtree(repo.repo_path, ignore_errors=True)
                removed = True
    except Exception:
        pass
    # Belt-and-braces: also blow away the predicted dir if it still exists.
    d = _cache_dir(model_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
        removed = True
    return removed


def languages_payload() -> list[dict]:
    return [{"code": c, "name": n} for c, n in LANGUAGES]


# ----- Download with progress -----

# ----- Cancellable downloads (child-process based) -----
#
# snapshot_download runs inside a multiprocessing.Process so we can terminate()
# it on cancel. Python threads can't be killed cleanly; mid-file cancellation
# would otherwise be impossible. Partial files left in the HF cache on cancel
# are resumable on the next download.

_downloads_lock = threading.Lock()
_active_downloads: dict[str, "mp.Process"] = {}
_cancelled_ids: set[str] = set()


def _hf_download_worker(model_id: str, cache_dir: str):
    """Child-process entry point. Just runs snapshot_download into cache_dir.
    Parent terminate() kills this process; HF cache state on disk is preserved."""
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=model_id, cache_dir=cache_dir)
    except KeyboardInterrupt:
        pass


def download_model(model_id: str, on_progress: Callable[[dict], None]):
    """
    Download a model from HF Hub in a child process; emit periodic progress.

    Payload shapes via on_progress:
        {"model_id": str, "status": "downloading", "bytes": int}
        {"model_id": str, "status": "complete",  "path": str, "bytes": int}
        {"model_id": str, "status": "cancelled", "bytes": int}
        {"model_id": str, "status": "error",     "error": str}
    """
    hub_dir = _hub_dir()
    cache_dir = _cache_dir(model_id)
    ctx = mp.get_context("spawn")

    with _downloads_lock:
        existing = _active_downloads.get(model_id)
        if existing and existing.is_alive():
            on_progress({"model_id": model_id, "status": "error", "error": "already downloading"})
            return
        _cancelled_ids.discard(model_id)
        proc = ctx.Process(
            target=_hf_download_worker, args=(model_id, str(hub_dir)), daemon=True
        )
        _active_downloads[model_id] = proc

    try:
        proc.start()
        # Poll once per second; emit progress; check liveness.
        while True:
            on_progress({
                "model_id": model_id,
                "status": "downloading",
                "bytes": _dir_size(cache_dir),
            })
            proc.join(timeout=1.0)
            if not proc.is_alive():
                break
    finally:
        with _downloads_lock:
            _active_downloads.pop(model_id, None)
            was_cancelled = model_id in _cancelled_ids
            _cancelled_ids.discard(model_id)

    if was_cancelled:
        on_progress({
            "model_id": model_id,
            "status": "cancelled",
            "bytes": _dir_size(cache_dir),
        })
    elif proc.exitcode == 0:
        on_progress({
            "model_id": model_id,
            "status": "complete",
            "path": str(cache_dir),
            "bytes": _dir_size(cache_dir),
        })
    else:
        on_progress({
            "model_id": model_id,
            "status": "error",
            "error": f"download failed (exit code {proc.exitcode})",
        })


def cancel_download(model_id: str) -> bool:
    """Stop an in-progress download. Returns True if anything was actually running."""
    with _downloads_lock:
        proc = _active_downloads.get(model_id)
        if proc is None or not proc.is_alive():
            return False
        _cancelled_ids.add(model_id)

    proc.terminate()
    try:
        proc.join(timeout=3)
    except Exception:
        pass
    if proc.is_alive():
        proc.kill()
        proc.join(timeout=2)
    return True


# ----- GPU probe -----

def gpu_info() -> dict:
    try:
        import ctranslate2
        n = ctranslate2.get_cuda_device_count()
        return {"cuda_available": n > 0, "device_count": n}
    except Exception as e:
        return {"cuda_available": False, "error": str(e)}
