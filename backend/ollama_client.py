"""
Minimal Ollama HTTP client (stdlib only).

Ollama runs as a separate local daemon the user starts themselves
(`ollama serve`, or the tray app). We never spawn or manage it — we just talk to
its REST API on 127.0.0.1:11434. If it isn't running, calls fail fast and the UI
falls back to the copy/paste flow.

Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
"""
import json
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:11434"


class OllamaError(Exception):
    """Raised when Ollama is unreachable or returns an error."""


def _url(base: str, path: str) -> str:
    return base.rstrip("/") + path


def list_models(base_url: str = DEFAULT_URL, timeout: float = 5.0) -> list[str]:
    """Return installed model names (e.g. ['llama3:latest', 'gemma2:9b']).

    Raises OllamaError if the daemon isn't reachable so the caller can tell
    "not running" apart from "running but no models".
    """
    try:
        req = urllib.request.Request(_url(base_url, "/api/tags"))
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError) as e:
        raise OllamaError(f"Can't reach Ollama at {base_url} — is it running?") from e
    except Exception as e:
        raise OllamaError(f"Unexpected response from Ollama: {e}") from e

    models = data.get("models") or []
    names = [m.get("name") for m in models if m.get("name")]
    return names


def generate(
    base_url: str,
    model: str,
    prompt: str,
    timeout: float = 600.0,
) -> str:
    """Run a non-streaming completion and return the raw text response.

    `format="json"` asks Ollama to constrain output to valid JSON, which matches
    our correction contract. The caller still runs it through the tolerant
    parser (parseAiJson) since not every model honors it perfectly.
    """
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.2},
    }).encode("utf-8")

    req = urllib.request.Request(
        _url(base_url, "/api/generate"),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            pass
        raise OllamaError(f"Ollama returned HTTP {e.code}: {detail or e.reason}") from e
    except (urllib.error.URLError, OSError) as e:
        raise OllamaError(f"Can't reach Ollama at {base_url} — is it running?") from e

    return data.get("response", "")
