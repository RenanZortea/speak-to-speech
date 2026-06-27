"""
Persisted app settings — a small JSON file at ~/SpeakToSpeech/settings.json.

Only durable, user-chosen preferences live here (e.g. where models are stored).
In-memory/runtime knobs like CPU threads stay in main.Api. Read at call time so
changes take effect without an app restart.

`models_dir` is the Hugging Face *hub* cache directory — the folder that holds the
`models--org--name/` subfolders. Defaults to the standard HF location so existing
downloads are still found out of the box.
"""
import json
import threading
from pathlib import Path

BASE = Path.home() / "SpeakToSpeech"
SETTINGS_PATH = BASE / "settings.json"
DEFAULT_MODELS_DIR = Path.home() / ".cache" / "huggingface" / "hub"

_lock = threading.Lock()
_cache: dict | None = None


def _load() -> dict:
    global _cache
    with _lock:
        if _cache is None:
            try:
                _cache = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            except Exception:
                _cache = {}
        return dict(_cache)


def _save(data: dict) -> None:
    global _cache
    with _lock:
        _cache = dict(data)
        BASE.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )


def get_models_dir() -> Path:
    """Configured hub cache dir, or the HF default if unset."""
    d = _load().get("models_dir")
    return Path(d) if d else DEFAULT_MODELS_DIR


def is_models_dir_custom() -> bool:
    return bool(_load().get("models_dir"))


def set_models_dir(path: str | None) -> Path:
    """Persist a new models dir. Pass None/empty to reset to the HF default.
    Returns the effective dir."""
    data = _load()
    if path:
        data["models_dir"] = str(Path(path))
    else:
        data.pop("models_dir", None)
    _save(data)
    return get_models_dir()


def get_ollama_url() -> str:
    """Base URL of the local Ollama daemon. Defaults to the standard port."""
    from ollama_client import DEFAULT_URL
    return _load().get("ollama_url") or DEFAULT_URL


def set_ollama_url(url: str | None) -> str:
    data = _load()
    if url:
        data["ollama_url"] = url.strip()
    else:
        data.pop("ollama_url", None)
    _save(data)
    return get_ollama_url()


def get_ollama_model() -> str | None:
    """Last-selected Ollama model name, or None if never chosen."""
    return _load().get("ollama_model") or None


def set_ollama_model(model: str | None) -> str | None:
    data = _load()
    if model:
        data["ollama_model"] = model
    else:
        data.pop("ollama_model", None)
    _save(data)
    return get_ollama_model()
