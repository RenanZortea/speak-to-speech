# Accent Analysis subsystem — design

**Date:** 2026-07-09
**Status:** Approved, pending implementation plan

## Goal

Add an "accent analysis" capability to SpeakToSpeech. Ship the English accent
classifier (`bookbot/english-accent-classifier`) as the first concrete model, but
build the plumbing so any per-language accent-classifier model of the same
architecture can be dropped in later via a catalog entry.

This is distinct from the existing pronunciation layer: pronunciation
(`wav2vec2-xlsr-53-espeak-cv-ft`) gives *per-phoneme acoustic confidence*
(language-agnostic). Accent analysis gives a *whole-clip categorical label* from a
fixed, per-language label set (e.g. which of 16 English regional accents the clip
sounds like). The accent model is English-only; it is meaningful only on clips in
its target language, so the feature is gated on the session's language.

## What the source model actually is

`bookbot/english-accent-classifier` is a SpeechBrain model (mirror of
`Jzuluaga/accent-id-commonaccent_xlsr-en-english`). Files:
- `wav2vec2.ckpt` (1.26 GB) — fine-tuned `facebook/wav2vec2-large-xlsr-53` backbone
- `model.ckpt` (66 KB) — the classification head
- `label_encoder.txt` — index → accent label (16 English accents)
- `hyperparams.yaml`, `custom_interface.py` — SpeechBrain `foreign_class` graph

The documented load path is SpeechBrain's `foreign_class()`, which executes repo
Python and pulls in the SpeechBrain framework. We do **not** use that path (see
Loader decision). The graph itself is trivial:

```
Wav2Vec2Model(facebook/wav2vec2-large-xlsr-53)   # backbone, weights from wav2vec2.ckpt
  -> masked mean-pool over time  -> [B, 1024]       # StatisticsPooling(return_std=False)
  -> Linear(1024 -> N, bias=False)                  # head, weights from model.ckpt
  -> softmax -> argmax -> label_encoder[idx]
```

`return_std=False` means statistics pooling reduces to masked mean-pooling, which
is why the linear input is 1024 (not 2048).

## Loader decision: vendor a minimal loader

We reimplement the forward pass locally with plain CPU torch + transformers
`Wav2Vec2Model`, exactly like `pronunciation.py`. Rationale:

- No new heavy framework dependency (SpeechBrain) in the PyInstaller build.
- No execution of repo-shipped Python (`custom_interface.py`).
- Fits the existing offline (`local_files_only`) + HF-cache + model-validation
  machinery already used for the pronunciation model.
- Keeps the exact bookbot weights.

Trade-off accepted: more upfront engineering, and one fiddly step — the SpeechBrain
checkpoint's state-dict keys must be remapped to transformers `Wav2Vec2Model` names
at load. This is verified against the real checkpoint during the build with a small
key-prefix map, and guarded so a bad remap fails loudly rather than silently
mis-scoring.

## Architecture

### backend/accent.py — `AccentWorker(ModelHost)`
- CPU torch, single forward pass per clip.
- Runs through `JobLane` so it cannot overlap transcribe/pronounce.
- Loading forced offline (`local_files_only=True`), model files from the app models
  dir (same cache convention as `pronunciation.py`).
- Public method:
  `classify(audio_path, model_desc, on_done, on_error, on_status=None)`
  - `on_status({"status": "loading_model"|"converting"|"analyzing"})`
  - `on_done({ "label": str, "confidence": float,
               "probs": [{"label": str, "prob": float}, ...],
               "model_id": str })`
  - `on_error(str)`
- Audio prep reuses the 16 kHz mono ffmpeg conversion pattern from
  `pronunciation.py`.

**Why a new file, not extending `pronunciation.py`:** different task (whole-clip
categorical vs per-phoneme confidence), different weights, different output shape.
Each worker stays single-purpose.

### backend/model_manager.py — `ACCENT_MODELS` catalog
Same shape as the Whisper catalog, keyed by language. v1 entry:

```python
{ "id": "bookbot/english-accent-classifier", "language": "en",
  "name": "English Accent Classifier", "size": "~1.3 GB",
  "loader": "xlsr-statpool-linear", "labels_file": "label_encoder.txt" }
```

- Download reuses the existing cancellable HF-download child-process path.
- `loader` is the generalization key: v1 has exactly one loader type
  (`xlsr-statpool-linear`). A new language that shares this architecture needs only
  a new catalog row.

### backend/main.py — Api surface
- `list_accent_models()` / install / cancel-download / delete, mirroring the
  existing model-management Api methods (reuse where possible).
- `analyze_accent(session_id)` — enqueues an `AccentWorker.classify` job on the
  `JobLane`, emits status/result via the existing `__emit` event bus.

### frontend
- `api.ts`: typed wrappers + event types for the accent result/status.
- Accent readout rendered in the pronunciation bar area: top label as a badge
  (e.g. **US · 87%**) with a small top-3 probability breakdown.
- An "Analyze accent" action, **enabled only when** an installed accent model's
  `language` matches the current session's `language`.
- **On-demand only** — never auto-run on session open (full ~1.3 GB model load +
  forward pass).

## Data flow

1. User opens a session (has a `language`, stored in `sessions.db`).
2. If an installed accent model matches that language, the "Analyze accent" action
   is enabled.
3. User clicks it → `analyze_accent(session_id)` → `JobLane` job →
   `AccentWorker.classify` on the session's audio.
4. Status events drive a small spinner; the result event renders the badge +
   top-3 bars.
5. Result is transient for v1 (recomputed on demand). Persisting the last accent
   result into `sessions.db` is a possible later extension, not in v1.

## Scope boundaries (YAGNI)

- **In v1:** whole-clip classification only; English model only; on-demand;
  transient result; readout in the pron bar.
- **Deferred:** per-segment accent, persisting results, additional languages
  (they need only a catalog row once available), any per-accent coaching/feedback.

## Generalization contract

"Recycle for any language" = the `loader` + catalog descriptor. Adding a language
later means: add an `ACCENT_MODELS` row (matching-architecture model + its
`language` + its label file). The worker, download path, language gating, and UI
readout already handle it generically. Nothing English-specific lives outside the
catalog row and the label file.

## Verification

Verification is hands-on by the user in the running app (consistent with the
project's working style — the GUI can't be driven by the assistant). The assistant
will provide:

- An offline parity check for the vendored loader: reproduce SpeechBrain's output
  on a small number of reference `(clip -> label, prob)` pairs, confirming the
  state-dict key remap is correct (this is the one place silent error could hide).
- Frontend typecheck (`npx tsc --noEmit`) and a backend import/smoke check.

The user runs the in-app end-to-end verification (record/open a session → Analyze
accent → confirm the readout) once implementation is finished.

## Risks / open items

- **State-dict key remap** (SpeechBrain → transformers `Wav2Vec2Model`) is the main
  correctness risk; mitigated by the parity check above.
- **Model size** (~1.3 GB) — acceptable, same XLSR family as the pronunciation
  model; on-demand load keeps it off the hot path.
- **Label meaningfulness on wrong-language audio** — mitigated by gating the action
  on session language.
