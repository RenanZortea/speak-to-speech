# Accent Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-demand, per-language accent classification to SpeakToSpeech, shipping the English `bookbot/english-accent-classifier` as the first model behind a generic seam.

**Architecture:** A new CPU `AccentWorker(ModelHost)` runs a *vendored* reimplementation of the model's graph (XLSR backbone → masked mean-pool → `Linear(1024→N)` → softmax) — no SpeechBrain framework, no repo code execution. It runs through the existing `JobLane`. A new `ACCENT_MODELS` catalog in `model_manager.py` (keyed by language) drives download + UI gating, reusing the existing HF-download machinery. The frontend adds an on-demand accent readout next to the pronunciation bar, enabled only when an installed accent model's language matches the current session's language.

**Tech Stack:** Python 3.11, torch (CPU), transformers (`Wav2Vec2Model`, `Wav2Vec2FeatureExtractor`), huggingface_hub, soundfile, ffmpeg; React + TypeScript frontend.

## Global Constraints

- Python venv (Linux dev): `.venv/bin/python` at repo root. **Not** global Python.
- All model loads MUST be offline: `local_files_only=True`; validate scripts run with `HF_HUB_OFFLINE=1`.
- Models cache dir comes from `app_settings.get_models_dir()` (same cache the pronunciation + Whisper models use).
- Helper instances on the `Api` class MUST be underscore-prefixed (`self._accent`) — pywebview walks any non-underscore attribute.
- Accent inference is CPU torch, single forward pass, serialized through `JobLane` (job name `"accent"`); it must not run concurrently with transcribe/pronounce.
- Accent analysis is **on-demand only** — never auto-run on session open.
- Frontend typecheck must pass: `cd frontend && npx tsc --noEmit`.
- No new heavy dependency (no `speechbrain`). Reuse transformers + torch already bundled.
- Vocab/label file for v1 model: `label_encoder.txt` (SpeechBrain `CategoricalEncoder` text format).

---

### Task 1: Accent-model catalog + presence helpers

**Files:**
- Modify: `backend/model_manager.py` (add after the `CATALOG` / `LANGUAGES` blocks and alongside the HF-cache helpers)

**Interfaces:**
- Consumes: existing `_hub_dir()`, `_scan_repo_sizes()`, `is_model_present()`, `download_model()`, `cancel_download()`, `delete_model()`.
- Produces:
  - `ACCENT_MODELS: list[dict]` — each `{"id", "language", "name", "size_bytes", "loader", "labels_file", "backbone", "num_labels"}`.
  - `accent_model_for_language(language: str) -> dict | None` — the catalog entry whose `language` matches, else `None`.
  - `list_accent_models() -> list[dict]` — each catalog entry plus `{"present": bool, "size_on_disk": int}`.

- [ ] **Step 1: Add the catalog constant**

In `backend/model_manager.py`, after the `LANGUAGES` list, add:

```python
# Accent-classifier models. Same download/cache machinery as Whisper models,
# but loaded by AccentWorker (vendored XLSR + mean-pool + linear head), keyed by
# the language whose accents they classify. `loader` is the generalization seam:
# any future entry sharing this architecture needs only a row here.
ACCENT_MODELS: list[dict] = [
    {
        "id": "bookbot/english-accent-classifier",
        "language": "en",
        "name": "English Accent Classifier",
        "size_bytes": 1_300_000_000,
        "loader": "xlsr-statpool-linear",
        "backbone": "facebook/wav2vec2-large-xlsr-53",
        "labels_file": "label_encoder.txt",
        "num_labels": 16,
    },
]
```

- [ ] **Step 2: Add the lookup + listing helpers**

Add near `languages_payload()`:

```python
def accent_model_for_language(language: str) -> Optional[dict]:
    """The accent model whose target language matches, if any."""
    for m in ACCENT_MODELS:
        if m["language"] == language:
            return m
    return None


def list_accent_models() -> list[dict]:
    """ACCENT_MODELS + presence/size on disk (reuses the HF cache scan)."""
    sizes = _scan_repo_sizes()

    def present(model_id: str, expected: int) -> bool:
        return sizes.get(model_id, 0) > max(50_000_000, expected // 2)

    return [
        {
            **m,
            "present": present(m["id"], m["size_bytes"]),
            "size_on_disk": sizes.get(m["id"], 0),
        }
        for m in ACCENT_MODELS
    ]
```

- [ ] **Step 3: Exclude accent models from the Whisper custom-repo listing**

In `list_models()`, the loop that appends cached repos not in `CATALOG` as `"custom"` currently skips only `PRON_MODEL_ID`. Accent models share the cache and must not appear as selectable Whisper models. Change the skip condition:

Find (around line 254):
```python
        if repo_id in known or repo_id == PRON_MODEL_ID:
            continue
```
Replace with:
```python
        if repo_id in known or repo_id == PRON_MODEL_ID:
            continue
        if any(a["id"] == repo_id for a in ACCENT_MODELS):
            continue
```

- [ ] **Step 4: Smoke-check the helpers**

Run:
```bash
.venv/bin/python -c "import sys; sys.path.insert(0,'backend'); import model_manager as mm; print([a['id'] for a in mm.list_accent_models()]); print(mm.accent_model_for_language('en')['name']); print(mm.accent_model_for_language('he'))"
```
Expected output:
```
['bookbot/english-accent-classifier']
English Accent Classifier
None
```

- [ ] **Step 5: Commit**

```bash
git add backend/model_manager.py
git commit -m "feat(accent): add accent-model catalog + presence helpers"
```

---

### Task 2: Vendored loader + label parser + parity validator

This is the correctness-critical task. The SpeechBrain checkpoint's state-dict keys must be remapped onto a transformers `Wav2Vec2Model`. Because the exact key prefixes and two reproduction knobs (output layer-norm; masked vs plain mean-pool) can only be confirmed against the real 1.3 GB checkpoint, this task **derives** the remap with an inspection script and locks it with a parity check, rather than guessing blindly.

**Files:**
- Create: `backend/accent_model.py` (the vendored `nn.Module` + checkpoint/label loaders)
- Create: `backend/validate_accent.py` (offline inspection + parity script)

**Interfaces:**
- Consumes: `ACCENT_MODELS` entry dict (Task 1) for `backbone` / `labels_file`.
- Produces:
  - `class AccentClassifier(torch.nn.Module)` with `forward(input_values, attention_mask=None) -> torch.Tensor` returning logits `[B, num_labels]`.
  - `load_accent_classifier(model_id: str, backbone: str, cache_dir: str, num_labels: int) -> AccentClassifier`.
  - `parse_label_encoder(path: str) -> list[str]` — index-ordered labels.
  - `remap_speechbrain_wav2vec2(state: dict) -> dict` — SpeechBrain ckpt keys → transformers `Wav2Vec2Model` keys.

- [ ] **Step 1: Write the label-encoder parser**

Create `backend/accent_model.py`:

```python
"""
Vendored accent classifier (no SpeechBrain framework).

Reimplements the bookbot/english-accent-classifier graph with plain torch +
transformers, so it loads offline and doesn't execute repo-shipped Python:

    Wav2Vec2Model(xlsr-53)  ->  masked mean-pool over time  [B, 1024]
      ->  Linear(1024 -> num_labels, bias=False)  ->  logits

The classifier head weights live in model.ckpt; the fine-tuned backbone weights
in wav2vec2.ckpt (a SpeechBrain checkpoint whose keys we remap). Labels come from
label_encoder.txt (SpeechBrain CategoricalEncoder text format).
"""
import re
from pathlib import Path


def parse_label_encoder(path: str) -> list[str]:
    """SpeechBrain CategoricalEncoder dump. Lines look like:  'us' => 0
    Returns labels ordered by index."""
    pairs: list[tuple[int, str]] = []
    line_re = re.compile(r"^'(?P<label>.+)'\s*=>\s*(?P<idx>\d+)\s*$")
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        m = line_re.match(raw.strip())
        if m:
            pairs.append((int(m.group("idx")), m.group("label")))
    pairs.sort(key=lambda p: p[0])
    return [label for _, label in pairs]
```

- [ ] **Step 2: Write the checkpoint key remapper (initial best-effort)**

Append to `backend/accent_model.py`:

```python
def remap_speechbrain_wav2vec2(state: dict) -> dict:
    """Map a SpeechBrain HuggingFaceWav2Vec2 checkpoint's keys onto a transformers
    Wav2Vec2Model state_dict. SpeechBrain wraps the HF model under a `model.`
    attribute, so its keys are typically prefixed `model.` (sometimes
    `wav2vec2.model.`). We strip that wrapper prefix; the remaining keys already
    match transformers Wav2Vec2Model. Task 2/Step 6 confirms the exact prefix
    against the real checkpoint and this function is adjusted if needed."""
    out: dict = {}
    for k, v in state.items():
        nk = k
        for prefix in ("wav2vec2.model.", "model.wav2vec2.", "model.", "wav2vec2."):
            if nk.startswith(prefix):
                nk = nk[len(prefix):]
                break
        out[nk] = v
    return out
```

- [ ] **Step 3: Write the module + loader**

Append to `backend/accent_model.py`:

```python
def _resolve_snapshot(model_id: str, cache_dir: str) -> Path:
    """Locate the downloaded snapshot dir for a repo in the HF cache."""
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(model_id, local_files_only=True, cache_dir=cache_dir))


class AccentClassifier:
    """XLSR backbone + masked mean-pool + linear head. Not an nn.Module subclass
    to keep construction explicit; holds torch modules and runs them in forward()."""

    def __init__(self, backbone, head, labels, feature_extractor, output_norm: bool):
        self.backbone = backbone            # transformers Wav2Vec2Model (eval)
        self.head = head                    # torch.nn.Linear(hidden, num_labels, bias=False)
        self.labels = labels                # list[str], index-ordered
        self.feature_extractor = feature_extractor
        self.output_norm = output_norm      # SpeechBrain output_norm=True → layer_norm on encoder output

    def forward(self, input_values, attention_mask=None):
        import torch
        with torch.no_grad():
            hidden = self.backbone(input_values, attention_mask=attention_mask).last_hidden_state  # [B,T,H]
            if self.output_norm:
                hidden = torch.nn.functional.layer_norm(hidden, (hidden.shape[-1],))
            if attention_mask is not None:
                mask = attention_mask.unsqueeze(-1).to(hidden.dtype)  # [B,T,1]
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
            else:
                pooled = hidden.mean(dim=1)
            return self.head(pooled)  # [B, num_labels]


def load_accent_classifier(model_id: str, backbone: str, cache_dir: str, num_labels: int):
    """Build the vendored classifier from the downloaded snapshot, fully offline."""
    import torch
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2Model

    snap = _resolve_snapshot(model_id, cache_dir)

    fe = Wav2Vec2FeatureExtractor.from_pretrained(
        backbone, local_files_only=True, cache_dir=cache_dir
    )
    bb = Wav2Vec2Model.from_pretrained(
        backbone, local_files_only=True, cache_dir=cache_dir
    )

    # Fine-tuned backbone weights (SpeechBrain ckpt) override the base xlsr weights.
    # weights_only=True: these are pure tensor state dicts — never unpickle repo code
    # (the whole reason we vendor instead of using SpeechBrain's foreign_class).
    w2v_ckpt = torch.load(snap / "wav2vec2.ckpt", map_location="cpu", weights_only=True)
    remapped = remap_speechbrain_wav2vec2(w2v_ckpt)
    missing, unexpected = bb.load_state_dict(remapped, strict=False)
    # `missing`/`unexpected` should be near-empty once the remap is confirmed
    # (Task 2/Step 6). A large mismatch means the prefix map is wrong.
    bb.eval()

    hidden = bb.config.hidden_size  # 1024 for xlsr-53
    head = torch.nn.Linear(hidden, num_labels, bias=False)
    head_ckpt = torch.load(snap / "model.ckpt", map_location="cpu", weights_only=True)
    # model.ckpt is the head's state_dict; its single weight tensor is [num_labels, hidden].
    head_state = head_ckpt if isinstance(head_ckpt, dict) else {"weight": head_ckpt}
    # Normalize the key to "weight" regardless of SpeechBrain's naming.
    if "weight" not in head_state:
        only = next(v for v in head_state.values() if hasattr(v, "shape"))
        head_state = {"weight": only}
    head.load_state_dict(head_state)
    head.eval()

    labels = parse_label_encoder(str(snap / "label_encoder.txt"))
    return AccentClassifier(bb, head, labels, fe, output_norm=True), (missing, unexpected)
```

- [ ] **Step 4: Write the offline inspection + parity validator**

Create `backend/validate_accent.py`:

```python
"""
Offline validator for the vendored accent classifier.

Two jobs:
  1. Inspect the SpeechBrain checkpoint's key prefixes vs the transformers
     Wav2Vec2Model, so the remap in accent_model.py can be confirmed/fixed.
  2. Parity: if SpeechBrain is importable in a scratch env, compare the vendored
     logits/argmax against foreign_class() on a sample wav. (Optional — skipped
     if speechbrain isn't installed. The primary correctness gate is that
     load_state_dict reports near-zero missing/unexpected keys.)

Run:  HF_HUB_OFFLINE=1 .venv/bin/python backend/validate_accent.py [sample.wav]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import torch  # noqa: E402
from app_settings import get_models_dir  # noqa: E402
from accent_model import _resolve_snapshot, load_accent_classifier, remap_speechbrain_wav2vec2  # noqa: E402
from transformers import Wav2Vec2Model  # noqa: E402

MODEL_ID = "bookbot/english-accent-classifier"
BACKBONE = "facebook/wav2vec2-large-xlsr-53"


def inspect_keys(cache_dir: str):
    snap = _resolve_snapshot(MODEL_ID, cache_dir)
    ckpt = torch.load(snap / "wav2vec2.ckpt", map_location="cpu", weights_only=True)
    ck = list(ckpt.keys())
    print(f"wav2vec2.ckpt: {len(ck)} keys; sample:")
    for k in ck[:8]:
        print("   ", k)
    ref = set(Wav2Vec2Model.from_pretrained(BACKBONE, local_files_only=True, cache_dir=cache_dir).state_dict())
    remapped = set(remap_speechbrain_wav2vec2(ckpt))
    print(f"transformers keys: {len(ref)}; remapped matches: {len(remapped & ref)}/{len(ref)}")
    print("unmatched remapped (first 8):", list(remapped - ref)[:8])


def main():
    cache_dir = str(get_models_dir())
    inspect_keys(cache_dir)
    clf, (missing, unexpected) = load_accent_classifier(MODEL_ID, BACKBONE, cache_dir, 16)
    print(f"load_state_dict: {len(missing)} missing, {len(unexpected)} unexpected")
    print("labels:", clf.labels)
    if len(sys.argv) > 1:
        import soundfile as sf
        audio, sr = sf.read(sys.argv[1], dtype="float32")
        inputs = clf.feature_extractor(audio, sampling_rate=sr, return_tensors="pt", padding=True)
        logits = clf.forward(inputs.input_values, inputs.get("attention_mask"))
        probs = torch.softmax(logits, dim=-1)[0]
        idx = int(probs.argmax())
        print(f"PRED: {clf.labels[idx]}  conf={probs[idx]:.3f}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Typecheck-free import smoke (no model needed)**

Run:
```bash
.venv/bin/python -c "import sys; sys.path.insert(0,'backend'); import accent_model as a; print(a.parse_label_encoder.__name__); print(a.remap_speechbrain_wav2vec2({'model.encoder.x': 1, 'model.feature_projection.y': 2}))"
```
Expected: prints `parse_label_encoder` then `{'encoder.x': 1, 'feature_projection.y': 2}` (prefix stripped).

- [ ] **Step 6: Confirm the remap against the real checkpoint (requires the model downloaded)**

> This step needs `bookbot/english-accent-classifier` present in the cache. If not yet downloaded, it happens during in-app verification; run this then and adjust `remap_speechbrain_wav2vec2` if the match rate is low.

Run:
```bash
HF_HUB_OFFLINE=1 .venv/bin/python backend/validate_accent.py
```
Expected: `remapped matches: N/N` (or very close), and `load_state_dict: ~0 missing, ~0 unexpected`. If the match rate is low, edit the prefix list in `remap_speechbrain_wav2vec2` using the printed sample keys, and (if `label_encoder`/`normalizer` tensors show up as `unexpected`) drop non-`Wav2Vec2Model` keys. If parity on a sample wav disagrees with the model card's expected label, toggle `output_norm` and masked-vs-plain pooling until it matches.

- [ ] **Step 7: Commit**

```bash
git add backend/accent_model.py backend/validate_accent.py
git commit -m "feat(accent): vendored XLSR classifier + offline parity validator"
```

---

### Task 3: AccentWorker

**Files:**
- Create: `backend/accent.py`

**Interfaces:**
- Consumes: `load_accent_classifier` (Task 2); `ModelHost` from `orchestration`; `get_models_dir` from `app_settings`.
- Produces:
  - `class AccentWorker(ModelHost)` with `classify(audio_path, model_desc, on_done, on_error, on_status=None)`.
  - `on_done` payload: `{"label": str, "confidence": float, "probs": [{"label": str, "prob": float}, ...], "model_id": str}`.

- [ ] **Step 1: Write the worker**

Create `backend/accent.py`:

```python
"""
Accent analysis worker. Whole-clip categorical accent classification via the
vendored XLSR classifier (see accent_model.py). CPU torch, one forward pass,
serialized through the JobLane like PronunciationWorker.
"""
import os
import subprocess
import tempfile
from pathlib import Path

from orchestration import ModelHost

SAMPLE_RATE = 16000


def _to_wav16k(src: str) -> str:
    out = Path(tempfile.gettempdir()) / "stt_accent.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", str(SAMPLE_RATE), "-ac", "1", str(out)],
        check=True,
        capture_output=True,
    )
    return str(out)


class AccentWorker(ModelHost):
    id = "accent"
    device = "cpu"

    def __init__(self):
        super().__init__()
        self._loaded_id = None
        self.cpu_threads = None

    def _on_unload(self):
        self._loaded_id = None

    def load(self, model_desc: dict):
        with self._lock:
            if self._model is not None and self._loaded_id == model_desc["id"]:
                return
            import torch
            from accent_model import load_accent_classifier
            from app_settings import get_models_dir

            threads = self.cpu_threads or max(1, (os.cpu_count() or 4) // 2)
            torch.set_num_threads(threads)

            clf, _keys = load_accent_classifier(
                model_desc["id"], model_desc["backbone"],
                str(get_models_dir()), model_desc["num_labels"],
            )
            self._model = clf
            self._loaded_id = model_desc["id"]

    def classify(self, audio_path, model_desc, on_done, on_error, on_status=None):
        try:
            import torch

            if not self.is_loaded or self._loaded_id != model_desc["id"]:
                if on_status:
                    on_status({"status": "loading_model"})
                self.load(model_desc)

            if on_status:
                on_status({"status": "converting"})
            wav_path = _to_wav16k(audio_path)

            import soundfile as sf
            audio, sr = sf.read(wav_path, dtype="float32")

            if on_status:
                on_status({"status": "analyzing"})
            clf = self._model
            inputs = clf.feature_extractor(
                audio, sampling_rate=sr, return_tensors="pt", padding=True
            )
            logits = clf.forward(inputs.input_values, inputs.get("attention_mask"))
            probs = torch.softmax(logits, dim=-1)[0]

            ranked = sorted(
                ({"label": clf.labels[i], "prob": round(float(p), 4)}
                 for i, p in enumerate(probs.tolist())),
                key=lambda r: r["prob"], reverse=True,
            )
            on_done({
                "label": ranked[0]["label"],
                "confidence": ranked[0]["prob"],
                "probs": ranked,
                "model_id": model_desc["id"],
            })
        except Exception as e:
            on_error(str(e))
```

- [ ] **Step 2: Import smoke**

Run:
```bash
.venv/bin/python -c "import sys; sys.path.insert(0,'backend'); from accent import AccentWorker; w=AccentWorker(); print(w.id, w.device, w.is_loaded)"
```
Expected: `accent cpu False`

- [ ] **Step 3: Commit**

```bash
git add backend/accent.py
git commit -m "feat(accent): AccentWorker (CPU, vendored classifier, JobLane-ready)"
```

---

### Task 4: Api wiring in main.py

**Files:**
- Modify: `backend/main.py` (imports near line 54; `Api.__init__` near line 84; new methods after the Pronunciation block ~line 253)

**Interfaces:**
- Consumes: `AccentWorker` (Task 3); `list_accent_models`, `accent_model_for_language` (Task 1); existing `self._jobs`, `self._emit`, `mm_download_model`, `mm_cancel_download`, `self._release_when_idle`.
- Produces Api methods: `list_accent_models()`, `download_accent_model(model_id)`, `cancel_accent_download(model_id)`, `analyze_accent(audio_path, language)`; events `accent_status`, `accent_model_download`.

- [ ] **Step 1: Import the worker + catalog helpers**

In `backend/main.py`, extend the model_manager import (near line 54–55 area) to include the accent helpers. Find the existing `from model_manager import (...)` block and add `list_accent_models as mm_list_accent_models` and `accent_model_for_language`. Also add:
```python
from accent import AccentWorker
```
alongside `from pronunciation import PRON_MODEL_ID, PronunciationWorker`.

- [ ] **Step 2: Instantiate the worker**

In `Api.__init__`, after `self._pron = PronunciationWorker()` (line 84):
```python
        self._accent = AccentWorker()
```

- [ ] **Step 3: Add the Api methods**

After the `assess_pronunciation` method / before `# ---- Sessions`, add:

```python
    # ---- Accent ----

    def list_accent_models(self):
        return mm_list_accent_models()

    def download_accent_model(self, model_id: str):
        def run():
            mm_download_model(model_id, lambda p: self._emit("accent_model_download", p))
        threading.Thread(target=run, daemon=True).start()
        return {"started": True, "model_id": model_id}

    def cancel_accent_download(self, model_id: str):
        return {"cancelled": mm_cancel_download(model_id)}

    def analyze_accent(self, audio_path: str, language: str):
        desc = accent_model_for_language(language)
        if desc is None:
            self._emit("accent_status", {
                "status": "error",
                "error": f"No accent model for language '{language}'.",
            })
            return {"started": False}

        def job():
            self._accent.classify(
                audio_path, desc,
                on_done=lambda d: self._emit("accent_status", {"status": "done", **d}),
                on_error=lambda err: self._emit("accent_status", {"status": "error", "error": err}),
                on_status=lambda s: self._emit("accent_status", s),
            )

        def run():
            ok = self._jobs.try_run("accent", job)
            if ok and self._release_when_idle:
                self._accent.unload()
            elif not ok:
                self._emit("accent_status", {
                    "status": "error",
                    "error": f"Busy with '{self._jobs.current}' — wait for it to finish.",
                })
        threading.Thread(target=run, daemon=True).start()
        return {"started": True}
```

> Confirm the exact symbols in the existing `from model_manager import (...)` block and match the local alias style (e.g. `download_model as mm_download_model`, `cancel_download as mm_cancel_download`). If those aliases don't exist, use whatever names are already imported.

- [ ] **Step 4: Import smoke (bridge introspection safety)**

Run:
```bash
.venv/bin/python -c "import sys; sys.path.insert(0,'backend'); import ast; ast.parse(open('backend/main.py').read()); print('main.py parses')"
```
Expected: `main.py parses`

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat(accent): Api methods + JobLane wiring + events"
```

---

### Task 5: Frontend api.ts types + wrappers + events

**Files:**
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: backend events `accent_status`, `accent_model_download`; Api methods from Task 4.
- Produces:
  - Types `AccentProb`, `AccentResult`, `AccentModelInfo`.
  - Methods on the api wrapper: `listAccentModels()`, `downloadAccentModel(id)`, `cancelAccentDownload(id)`, `analyzeAccent(audioPath, language)`.

- [ ] **Step 1: Add the types**

In `frontend/src/api.ts`, near the `PronunciationResult` type (line 77), add:
```typescript
export type AccentProb = { label: string; prob: number };
export type AccentResult = {
  label: string;
  confidence: number;
  probs: AccentProb[];
  model_id: string;
};
export type AccentModelInfo = {
  id: string;
  language: string;
  name: string;
  size_bytes: number;
  present: boolean;
  size_on_disk: number;
};
```

- [ ] **Step 2: Add the wrapper methods**

Near `assessPronunciation` (line 275), add:
```typescript
  async listAccentModels(): Promise<AccentModelInfo[]> {
    return (await ready()).list_accent_models();
  },
  async downloadAccentModel(modelId: string): Promise<{ started: boolean; model_id: string }> {
    return (await ready()).download_accent_model(modelId);
  },
  async cancelAccentDownload(modelId: string): Promise<{ cancelled: boolean }> {
    return (await ready()).cancel_accent_download(modelId);
  },
  async analyzeAccent(audioPath: string, language: string): Promise<{ started: boolean }> {
    return (await ready()).analyze_accent(audioPath, language);
  },
```

> Match the surrounding object/method syntax exactly (the api object uses `async method()` members). If methods are defined inside an object literal, keep the trailing commas; if it's a class, use class-method syntax.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(accent): frontend api types + wrappers"
```

---

### Task 6: AccentBar component + App wiring

**Files:**
- Create: `frontend/src/AccentBar.tsx`
- Modify: `frontend/src/App.tsx` (state, event listeners, render near the `PronunciationBar` at line ~620)

**Interfaces:**
- Consumes: `AccentResult`, `AccentModelInfo`, api methods (Task 5); the current session language; the current audio path.
- Produces: an on-demand accent readout rendered adjacent to `PronunciationBar`.

- [ ] **Step 1: Write the component**

Create `frontend/src/AccentBar.tsx`:

```typescript
import { Globe, Loader2, Download, Square, AlertCircle } from "lucide-react";
import type { AccentResult } from "./api";

export type AccentStatus =
  | "idle"
  | "loading_model"
  | "converting"
  | "analyzing"
  | "done"
  | "error";

interface Props {
  hasAudio: boolean;
  supported: boolean;            // an accent model exists for this session's language
  modelPresent: boolean | null;  // null until known
  downloadBytes: number | null;
  status: AccentStatus;
  result: AccentResult | null;
  error: string | null;
  onAnalyze: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
}

const MODEL_SIZE = 1_300_000_000;

export function AccentBar({
  hasAudio, supported, modelPresent, downloadBytes,
  status, result, error, onAnalyze, onDownload, onCancelDownload,
}: Props) {
  if (!hasAudio || !supported) return null;

  const analyzing =
    status === "loading_model" || status === "converting" || status === "analyzing";

  if (downloadBytes !== null) {
    return (
      <div className="pron-bar">
        <span className="pb-text">
          Downloading accent model… {fmtBytes(downloadBytes)} / ~1.3 GB
        </span>
        <div className="pb-progress">
          <div className="pb-progress-fill"
            style={{ width: `${Math.min(100, (downloadBytes / MODEL_SIZE) * 100)}%` }} />
        </div>
        <button className="btn ghost danger pb-btn" onClick={onCancelDownload}>
          <Square size={11} fill="currentColor" /><span>Cancel</span>
        </button>
      </div>
    );
  }

  if (modelPresent === false) {
    return (
      <div className="pron-bar">
        <span className="pb-text">Accent analysis needs a one-time model download (~1.3 GB).</span>
        <button className="btn primary pb-btn" onClick={onDownload}>
          <Download size={14} /><span>Download model</span>
        </button>
        {error && <span className="pb-error"><AlertCircle size={13} /> {error}</span>}
      </div>
    );
  }

  return (
    <div className="pron-bar">
      <button className="btn primary pb-btn" onClick={onAnalyze} disabled={analyzing}>
        {analyzing ? (
          <><Loader2 size={14} className="spin" /><span>{statusLabel(status)}</span></>
        ) : (
          <><Globe size={14} /><span>{result ? "Re-analyze accent" : "Analyze accent"}</span></>
        )}
      </button>

      {status === "error" && error && (
        <span className="pb-error"><AlertCircle size={13} /> {error}</span>
      )}

      {result && status === "done" && (
        <>
          <div className="pb-score">
            <span className="pb-score-label">Accent</span>
            <span className="pb-score-value">
              {result.label} · {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <div className="pb-weakest">
            {result.probs.slice(0, 3).map((p) => (
              <span key={p.label} className="pb-weakest-chip">
                <span className="pb-weakest-sym">{p.label}</span>
                <span className="pb-weakest-meta">{Math.round(p.prob * 100)}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function statusLabel(kind: string): string {
  if (kind === "loading_model") return "Loading model…";
  if (kind === "converting") return "Preparing audio…";
  if (kind === "analyzing") return "Analyzing…";
  return "Working…";
}

function fmtBytes(b: number): string {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
```

- [ ] **Step 2: Add App state + accent-model discovery**

In `frontend/src/App.tsx`, near the pronunciation state (line ~84), add accent state:
```typescript
  const [accentModels, setAccentModels] = useState<AccentModelInfo[]>([]);
  const [accentStatus, setAccentStatus] = useState<AccentStatus>("idle");
  const [accentResult, setAccentResult] = useState<AccentResult | null>(null);
  const [accentError, setAccentError] = useState<string | null>(null);
  const [accentDownloadBytes, setAccentDownloadBytes] = useState<number | null>(null);
```
Add imports at the top: `import { AccentBar, type AccentStatus } from "./AccentBar";` and extend the `./api` import with `type AccentModelInfo, type AccentResult`.

Load the accent-model list once on mount (mirror however pron model presence is fetched — likely a `useEffect` calling `api.listAccentModels().then(setAccentModels)`).

- [ ] **Step 3: Wire the event listeners**

Where the app subscribes to `pron_status` (search `on("pron_status"`), add sibling subscriptions:
```typescript
    const offAccent = on("accent_status", (p: any) => {
      if (p.status === "done") {
        setAccentResult(p as AccentResult);
        setAccentStatus("done");
      } else if (p.status === "error") {
        setAccentError(p.error);
        setAccentStatus("error");
      } else {
        setAccentStatus(p.status);
      }
    });
    const offAccentDl = on("accent_model_download", (p: any) => {
      if (p.status === "downloading") setAccentDownloadBytes(p.bytes);
      else {
        setAccentDownloadBytes(null);
        if (p.status === "complete") void api.listAccentModels().then(setAccentModels);
      }
    });
```
Return both `offAccent()` and `offAccentDl()` from the effect cleanup alongside the existing unsubscribers.

- [ ] **Step 4: Derive language support + handlers**

Add near `handleAnalyzePronunciation` (line ~290). Use the current session's language (the value passed to Whisper / stored on the loaded session — reuse the same state the app already holds for language; if none, fall back to the transcribe language state):
```typescript
  const sessionLanguage = /* existing language state, e.g. */ language;
  const accentModel = accentModels.find((m) => m.language === sessionLanguage) ?? null;

  const handleAnalyzeAccent = () => {
    if (!audio || !accentModel) return;
    setAccentError(null);
    setAccentStatus("loading_model");
    void api.analyzeAccent(audio.path, sessionLanguage);
  };
  const handleDownloadAccent = () => {
    if (!accentModel) return;
    void api.downloadAccentModel(accentModel.id);
  };
  const handleCancelAccentDownload = () => {
    if (!accentModel) return;
    void api.cancelAccentDownload(accentModel.id);
  };
```

> `language` is a placeholder for whatever the app already calls the current target-language state. Grep `App.tsx` for the language value passed into transcription and reuse it. Clear `accentResult`/`accentStatus` in the same place new audio invalidates pronunciation (line ~274).

- [ ] **Step 5: Render the component**

Next to `<PronunciationBar ... />` (line ~620), add:
```typescript
          <AccentBar
            hasAudio={!!audio}
            supported={!!accentModel}
            modelPresent={accentModel ? accentModel.present : null}
            downloadBytes={accentDownloadBytes}
            status={accentStatus}
            result={accentResult}
            error={accentError}
            onAnalyze={handleAnalyzeAccent}
            onDownload={handleDownloadAccent}
            onCancelDownload={handleCancelAccentDownload}
          />
```

- [ ] **Step 6: Typecheck**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors. Fix any mismatches between the placeholder `language` name and the real state variable.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/AccentBar.tsx frontend/src/App.tsx
git commit -m "feat(accent): AccentBar readout + App wiring (on-demand, language-gated)"
```

---

## Verification (hands-on, by the user)

Automated pytest is not this project's style; the user verifies in the running app. After Task 6:

1. `cd frontend && npx tsc --noEmit` → clean.
2. `.venv/bin/python backend/main.py --dev` → app launches, no bridge errors.
3. Open/record an **English** session → "Analyze accent" appears; first run prompts the ~1.3 GB download.
4. After download, run `HF_HUB_OFFLINE=1 .venv/bin/python backend/validate_accent.py <clip.wav>` (Task 2/Step 6) to confirm the key remap matched and the label looks right.
5. Click "Analyze accent" → badge + top-3 shows; verify it does **not** appear on a Hebrew session (language gating).

## Self-review notes

- Spec §Architecture → Tasks 3, 4 (worker + wiring). ✅
- Spec §Vendored loader → Task 2 (module + remap + validator). ✅
- Spec §Catalog/download → Task 1 + Task 4 download methods. ✅
- Spec §UI (on-demand, pron-bar area, language-gated) → Task 6. ✅
- Spec §Generalization contract (loader + catalog row) → Task 1 `ACCENT_MODELS.loader`, `accent_model_for_language`. ✅
- Spec §Verification (hands-on + parity) → Verification section + Task 2/Step 6. ✅
- Known open risk (state-dict remap) is explicitly a derive-and-confirm step, not a guess. ✅
