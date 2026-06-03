# SpeakToSpeech

> Local speech-to-text for language learning.

A desktop tool that transcribes audio recordings on your own GPU using
[faster-whisper](https://github.com/SYSTRAN/faster-whisper), then helps you
review the transcript against the original audio — built around the workflow
of finding "gap moments" (silences, code-switches to L1, errors) in your own
target-language speech and turning them into study material.

Default-tuned for Hebrew via [`ivrit-ai/whisper-large-v3-ct2`](https://huggingface.co/ivrit-ai/whisper-large-v3-ct2),
but you can swap to any official Whisper model or community fine-tune from the
built-in model manager (English, Spanish, Portuguese, French, German, Arabic,
Russian, ~99 languages via the multilingual models).

Built on **Python + faster-whisper + pywebview + React + wavesurfer.js**.
Single-user, fully local, no cloud.

---

## Why this exists

Transcription tools are a dime a dozen. This one is shaped for the
specific workflow of *re-listening to your own L2 speech to find what you
couldn't say*. Concretely that means:

- **Verbatim, not cleaned-up.** `temperature=0`, no VAD filter. Pauses and false
  starts are signal, not noise — they show you where you hesitated.
- **Confidence is surfaced, not hidden.** Each segment's `avg_logprob` becomes a
  colored left border (green → yellow → red). Red segments are the moments the
  model wasn't sure — usually exactly the moments *you* weren't sure.
- **Audio-to-transcript sync is the killer feature.** Click any segment to jump
  the player there. Loop the current segment. Slow playback to 0.5×. The
  waveform shows pauses as flat regions before you even hit play.

## Features

- **Transcribe**: pick an audio file, or record from your mic (auto-saves under `~/SpeakToSpeech/recordings/`)
- **Waveform** with click-to-seek, segment ticks overlaid as you transcribe
- **Playback controls**: play/pause, 0.5× – 1.5× speed, volume + mute, loop current segment
- **Hebrew typography** (Heebo) with RTL transcript rendering
- **Confidence coloring** per segment (avg_logprob → green/yellow/red border)
- **Live model swap** between any downloaded Whisper variant
- **Language picker** (Hebrew, English, 25+ others, or auto-detect)
- **Model manager**: download/delete/cancel, custom HF repo IDs, disk usage
- **Re-transcribe** the loaded audio with different temperature/model/language
- **Export** as timestamped `.txt`, plain `.txt`, `.srt`, or full `.json`; **Copy transcription** to clipboard
- **Free clipboard copy** of plain transcription

## Requirements

- **Windows + NVIDIA GPU** with CUDA-capable driver. Tested on RTX 2060 6 GB.
- **Python 3.11** (faster-whisper + CTranslate2 wheels don't build cleanly on 3.14 yet).
- **Node.js 18+** and **npm**.
- **ffmpeg** on PATH (any recent version).

Linux/macOS *will* work in principle — the only Windows-specific code is the
explicit CUDA DLL preload in `worker.py`. CPU-only inference also works
(swap `device="cuda"` → `device="cpu"` in `worker.py`), but it's painfully slow on
large models.

## Setup

### 1. Clone and create a venv

```powershell
git clone https://github.com/<your-username>/speak-to-speech.git
cd speak-to-speech
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install Python dependencies

```powershell
pip install -r backend/requirements.txt
pip install faster-whisper==1.2.1 ctranslate2==4.7.2
pip install nvidia-cublas-cu12==12.9.* nvidia-cudnn-cu12==9.*
```

The two extra pip lines install faster-whisper + CTranslate2 + the CUDA runtime
DLLs from PyPI (so you don't need a system-wide CUDA install — they ship with the
wheel). On Windows, `worker.py` preloads these DLLs by absolute path; the path is
derived from `sys.executable` so any venv layout works.

### 3. Install frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

## Run (dev mode)

Two terminals. Vite serves the frontend with hot reload; pywebview points at it.

**Terminal 1 — frontend:**
```powershell
cd frontend
npm run dev
```

**Terminal 2 — backend window:**
```powershell
.\.venv\Scripts\python.exe backend\main.py --dev
```

The window opens at `http://localhost:5173`. DevTools are enabled in dev mode
(right-click → Inspect).

## Run (built / "prod")

```powershell
cd frontend
npm run build
cd ..
.\.venv\Scripts\python.exe backend\main.py
```

## First launch

1. Window opens, top-right shows GPU status (`CUDA × 1` if all good).
2. If no Whisper model is downloaded, you'll see a "Download model" screen.
   The default Hebrew model is ~3 GB.
3. First transcription pays a ~10s model-load cost; subsequent ones don't.

**Slow downloads?** HuggingFace rate-limits anonymous requests. A free `HF_TOKEN`
from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
gives 5–10× the throughput. Set the env var before launching:

```powershell
$env:HF_TOKEN = "hf_yourtokenhere"
```

## Architecture (10-second tour)

```
backend/                Python — single long-lived process
├── main.py            pywebview window + Api exposed to JS
├── worker.py          WhisperWorker (model swap with unload-before-load)
├── model_manager.py   Catalog, HF cache mgmt, cancellable downloads
└── audio_server.py    Localhost HTTP server with Range support for <audio>

frontend/src/          Vite + React + TypeScript
├── App.tsx            State machine, event wiring
├── Sidebar.tsx        Source + model + language + options + export
├── AudioBar.tsx       Sticky waveform + transport + speed + volume + loop
├── Waveform.tsx       wavesurfer.js wrapper with segment ticks
├── Transcript.tsx     Segment list with confidence colors, click-to-seek
├── ModelManager.tsx   Modal: catalog + download/cancel/delete + custom HF id
├── Recorder.tsx       MediaRecorder → POST /upload → transcribe
├── api.ts             Typed wrapper over window.pywebview.api + event bus
└── formats.ts         TXT (timed/plain), SRT, JSON exporters
```

The Python ↔ JS bridge is pywebview's built-in: JS calls
`window.pywebview.api.<method>(args)`; Python pushes events back via
`window.evaluate_js("window.__emit(event, payload)")`.

Audio playback uses a tiny range-supporting HTTP server on `127.0.0.1` (random
port) so `<audio>` can stream + seek without loading the whole file into the
webview's JS memory.

## Choices worth knowing about

- **Transcription params** (`language=<picked>`, `temperature=0`, `vad_filter=False`,
  `beam_size=5`) are deliberate for the language-learning use case — verbatim
  fidelity over clean output. Don't change these to make output "look better"
  without understanding what you're losing.
- **Cancellable downloads use `multiprocessing`** so the HF download can be
  killed mid-file (`proc.terminate()`). Partial files in the HF cache resume on
  the next download — that's intentional.
- **Model swap unloads first** (`del model; gc.collect()`) before loading a new
  one. On a 6 GB GPU, loading on top of an existing model would OOM. This is
  why the bigger model swaps take a couple of seconds.
- **WebView2 mic permission is auto-granted** via
  `--use-fake-ui-for-media-stream`. Fine for a local single-user tool; remove
  before shipping anywhere multi-user.

## Roadmap (vague, not promises)

- Annotation layer: mark segments as gap / error / ok, attach corrected phrasing
- Anki export (CSV or `.apkg`) from flagged annotations
- Batch folder transcribe (one model load, many files)
- Linux / macOS support without manual DLL paths
- Pre-built installer (PyInstaller / NSIS)

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for the Whisper inference runtime
- [ivrit-ai](https://huggingface.co/ivrit-ai) for the Hebrew Whisper fine-tune
- [pywebview](https://pywebview.flowrl.com/) for the native window + JS bridge
- [wavesurfer.js](https://wavesurfer-js.org/) for the waveform rendering
- [Lucide](https://lucide.dev/) for the icons
