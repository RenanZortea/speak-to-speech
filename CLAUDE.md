# CLAUDE.md — context for AI sessions

SpeakToSpeech: a local, single-user desktop app for **language-learning speech review**.
Record/transcribe target-language speech (Hebrew-first), review it against the audio to
find gaps (mispronunciations, code-switches to L1, errors), and repair them. Verbatim
fidelity matters more than clean output — pauses/false-starts/errors are *signal*.

Stack: **Python (faster-whisper + wav2vec2) + pywebview** backend, **React + TypeScript +
CodeMirror 6 + wavesurfer.js** frontend. Local-only, no cloud, no auth.

## Run / build

- Python venv: `C:\whisper-he\Scripts\python.exe` (Python 3.11; has faster-whisper,
  ctranslate2, nvidia-cu12 DLLs, pywebview, torch-cpu, transformers, soundfile, psutil,
  nvidia-ml-py). **Do not use the global Python 3.14.**
- Dev: terminal 1 `cd frontend && npm run dev`; terminal 2
  `& C:\whisper-he\Scripts\python.exe backend\main.py --dev`.
- Typecheck: `cd frontend && npx tsc --noEmit`. Build frontend: `npm run build`.
- Full installer build: `.\build.ps1` (npm build → PyInstaller `SpeakToSpeech.spec` →
  Inno Setup `installer.iss` → portable zip). Flags: `-SkipFrontend -SkipInstaller -SkipZip -Clean`.
- Frozen pronunciation self-test: run the built EXE with `--selftest` (writes PASS/FAIL to
  `%TEMP%\SpeakToSpeech-launch.log`).

## Architecture

**backend/**
- `main.py` — pywebview window + `Api` class exposed to JS. Pushes events via
  `evaluate_js("window.__emit(event, payload)")`.
- `worker.py` — `WhisperWorker` (faster-whisper, GPU). CUDA DLL preload at top.
- `pronunciation.py` — `PronunciationWorker` (wav2vec2-xlsr-53-espeak phoneme CTC, CPU torch).
  Tokenizer bypassed (no espeak); loads offline.
- `orchestration.py` — `ModelHost` base, `ResourceManager` (≤1 GPU model resident),
  `JobLane` (serialize compute jobs, single busy signal).
- `model_manager.py` — model catalog, HF cache mgmt, cancellable downloads (mp child).
- `session_store.py` — SQLite at `~/SpeakToSpeech/sessions.db`; audio copied into app storage.
- `resources.py` — psutil CPU/RAM + NVML GPU/VRAM poller.
- `updater.py` / `version.py` — GitHub-release update check; version source of truth.
- `audio_server.py` — localhost HTTP w/ Range support + `POST /upload` for recordings.

**frontend/src/**
- `App.tsx` — top-level state + event wiring + all the handlers.
- `api.ts` — typed wrapper over `window.pywebview.api` + the `__emit` event bus.
- `CodeTranscript.tsx` — CM6 transcript surface. Decoration layers: pronunciation marks,
  active-word, corrections (replace widgets in Corrected view / tint in Original). Hover
  tooltip (pronunciation OR correction), click=seek, right-click=correction menu.
- `transcriptDoc.ts` — **shared** doc builder (CM6 + AI mapper must produce identical offsets).
- `alignment.ts` — pairs phonemes↔words by timestamp overlap; 2D confidence categories.
- `corrections.ts` — Correction model (immutable base, char-span anchored); `applyCorrections`.
- `aiCorrect.ts` — AI prompt builder, JSON parse, segment+quote→span mapping.
- `CorrectAiModal` / `CorrectionDialog` / `CorrectionMenu` — correction UI.
- `PronunciationBar`, `AudioBar`/`Waveform`, `Sidebar`, `SessionsRail`, `ResourceFooter`,
  `SettingsModal`, `ModelManager`, `Recorder`.

## Conventions / gotchas (hard-won — don't re-break)

- **CUDA DLLs**: `worker.py` preloads cublas/cudnn by absolute path *before* importing
  faster_whisper. Path derived from `sys.executable` (or `sys._MEIPASS` when frozen).
- **pywebview Api introspection**: any non-underscore attribute on `Api` gets walked by the
  JS-bridge generator. Keep helper instances **underscore-prefixed** (`self._worker`,
  `self._audio`, …) or it recurses into them (e.g. a `Path`) and breaks the whole bridge.
- **pywebview bridge race**: `window.pywebview.api` exists as `{}` before methods are
  attached. `api.ts`'s `ready()` waits for a *known method* (`check_model`), not just `api`.
- **PowerShell 5.1 reads BOM-less files as ANSI** → no non-ASCII in `.ps1` *code* (em-dashes
  in strings became smart-quotes and broke parsing). ASCII only in build.ps1.
- **HF offline**: pronunciation loads with `local_files_only=True` (and the validate script
  uses `HF_HUB_OFFLINE=1`) — otherwise transformers makes a blocking network call.
- **Immutable transcript**: corrections never mutate the base doc; they're overlays anchored
  to stable char spans. The "corrected version" is *derived*. New audio / re-transcribe
  clears corrections (offsets would no longer match).
- **2D confidence**: Whisper word `probability` (lexical) × wav2vec2 phoneme conf (acoustic)
  → clear / off-pronunciation / unclear-word(code-switch) / gap. See `alignment.ts`.
- **AI corrections = same `Correction` shape** as manual; the render/map/persist pipeline is
  shared. JSON is the contract; nothing AI-specific is bundled.

## State (as of this writing)

- **v0.2.0 released** (installer + portable zip on GitHub; in-app updater live).
- Done since: manual correction layer (right-click, inline corrected view, hover original
  strikethrough, Corrected/Original toggle in the pron bar), AI correction paste flow.
- **Personal next-steps live in `ROADMAP.md`** (gitignored). Highlights: Anki export from
  accepted corrections, optional accept/reject review stepper, phoneme/code-switch prompt
  enrichment, pronunciation IPA accuracy/tooltips/true-GOP, repo README refresh, code signing.

## Working style with this user

Iterative, hands-on. They test in the running app and report back; I can't drive the
pywebview GUI, so I verify via typecheck/build/backend smoke tests and hand off visual
checks. Commit when they say so. Brainstorm design before big features; they make the calls.
