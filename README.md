# SpeakToSpeech

> A desktop accent practice tool: listen, imitate, record, and refine your pronunciation.

SpeakToSpeech brings reference audio, recording, and vowel practice into one
workspace. Slow down a phrase, repeat it in your own voice, and listen back.
Use the vowel chart to explore how sounds change and see where your spoken
vowels sit relative to a target.

Local Whisper transcription helps you navigate and review your recordings.
The default model is tuned for Hebrew, with other languages available through
the model manager. Vowel practice includes General American English, Modern
Israeli Hebrew, Palestinian Arabic (Jerusalem approximation), and Brazilian
Portuguese.

## A practice session

1. **Listen.** Load a YouTube video in **Media**, or import an audio file.
   Slow down a phrase and use checkpoints or transcript segment loops to repeat it.
2. **Imitate and record.** Record your microphone, desktop audio, or both.
   Media's play-and-record control lets you practice alongside a video.
3. **Listen back.** Use the waveform and synchronized transcript to return to
   the phrase you want to work on. Compare what you hear with your reference.
4. **Focus on a vowel.** Open **Vowels**, choose a language and target, then
   use **Practice** to see your microphone's vowel position. Hold Space to hear
   the target and release it to speak. Play a recording to follow its vowels
   on the same chart.
5. **Keep practicing.** Save sessions to revisit recordings and transcripts,
   or export the transcript for further study.

## Features

### Vowel exploration and practice

- **Interactive vowel chart:** drag across the chart to hear synthesized vowels.
- **Live visual feedback:** track F1/F2 (the resonances used to place vowels on
  the chart), compare them with a selected target, and see adjustment hints.
- **Recording analysis:** follow vowel positions while recorded audio plays.
- **Sound controls:** adjust pitch, volume, and F1/F2/F3; choose male or female
  reference values for each supported language.

Reference points are guides for practice, not a score for your accent. Voices,
dialects, and connected speech vary. The Jerusalem Arabic targets approximate
central/northern Palestinian Arabic data; the app explains these reference
limitations in the vowel view.

### Listening, shadowing, and recording

- **YouTube practice:** focused playback with speed controls, checkpoints,
  short seeks, and play-and-record.
- **Flexible recording:** microphone, desktop audio, or both, with source
  selection and playback routing on Linux.
- **Audio review:** waveform seeking, transcript segment loops, playback at
  0.5×, 0.75×, or 1×, and volume controls.
- **Saved sessions:** return to earlier recordings and transcripts.

### Transcription for review

- **Local speech recognition** using [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
- **Model and language selection:** download, switch, or remove Whisper models,
  add a Hugging Face model ID, and select a language or auto-detect it.
- **Synchronized transcripts:** click a segment to seek; Hebrew text supports RTL.
- **Transcript corrections:** edit manually or use optional Ollama assistance.
- **Export:** timestamped or plain `.txt`, `.srt`, and `.json`, plus clipboard copy.

Transcription defaults to [`ivrit-ai/whisper-large-v3-ct2`](https://huggingface.co/ivrit-ai/whisper-large-v3-ct2).
Segment confidence reflects the speech recognition model's certainty; it is
not a pronunciation assessment.

Recordings and transcription are processed locally. Model downloads and YouTube
playback require internet access; YouTube sign-in uses its own account pages.

### Media controls and shortcuts

Paste a video, Shorts, live, or share link in Media and choose **Load video**. The actual YouTube website runs underneath a focused video surface. Its native timeline supports jumping through the video, with captions and settings available in the bottom control bar. The native **Skip ad** button appears when YouTube offers a skippable ad. Compact app controls provide play/pause, 1s/5s seeking, speed, checkpoints, and play-and-record. **Sign in** opens YouTube/Google's account flow using the same persistent profile; close it to return to practice. Browser toolbars, website links, recommendations, and popups are unavailable during practice, and navigation is restricted to the selected video. Switching tabs hides and pauses playback. Recording also remains available through the Source panel.

Media shortcuts use physical keys, matching Global Speed on Dvorak. **Shift + .** (physical Shift+W) sets/replaces the checkpoint; **.** (W) jumps to it; **o** (S) toggles 1× and the previous speed; **a / e** (A/D) decrease/increase speed by 0.1× within 0.25–2×. They work with focus on the app or video, share state with the buttons, and ignore text entry, dialogs, sign-in, and inactive Media tabs. The speed readout shows the actual rate. Shift-click the checkpoint button to replace its position.

## Requirements

- **Windows or Linux + NVIDIA GPU** with CUDA-capable driver. Tested on RTX 2060 6 GB
  (Windows 10/11 and Arch Linux under Wayland/Hyprland).
- **Python 3.11** (faster-whisper + CTranslate2 wheels don't build cleanly on 3.14 yet).
- **Node.js 18+** and **npm**.
- **ffmpeg** on PATH (any recent version).

The setup below targets Windows and Linux with NVIDIA CUDA for transcription.

Windows installers are available from [Releases](../../releases). On Arch Linux,
install the current checkout or run from source (see [Linux setup](#linux-setup-arch-tested)).

## Setup

### 1. Clone and create a venv

```powershell
git clone https://github.com/RenanZortea/speak-to-speech.git
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

On Linux, start both the Vite frontend and the desktop backend with:

```bash
./scripts/dev.sh
```

The launcher uses `.venv/bin/python`, waits for Vite, and opens the desktop window
needed for recording and transcription. It reuses an existing SpeakToSpeech Vite
server. Closing the window stops any server started by the launcher; an existing
server is left running. Set `SPEAKTOSPEECH_PYTHON` to override the Python path.

Alternatively, use two terminals. Vite serves the frontend with hot reload;
the Qt desktop shell loads it.

**Terminal 1 — frontend:**
```powershell
cd frontend
npm run dev
```

**Terminal 2 — backend window:**
```powershell
.\.venv\Scripts\python.exe backend\main.py --dev
```

The desktop shell loads the frontend from `http://localhost:5173`.

## Run (built / "prod")

```powershell
cd frontend
npm run build
cd ..
.\.venv\Scripts\python.exe backend\main.py
```

## Linux setup (Arch tested)

To install the current checkout as a desktop app on Arch Linux:

```bash
./scripts/install.sh
```

Run as your normal user. The script requests sudo when installing system
packages, builds the app with the existing local Arch package, and installs an
application-menu entry and the `speaktospeech` command. It includes uncommitted
changes. Python 3.11 is installed through `paru` or `yay` if needed; without an
AUR helper, install `python311` first. Downloads can total several GB.
Use `./scripts/install.sh --check` to check prerequisites without changing
anything. Re-run the installer to update; remove the app with
`sudo pacman -R speaktospeech`. Models and recordings remain in your home folder.

For a development environment instead, follow the manual steps below.

Same app, run from source. On Arch:

```bash
# System deps: Qt desktop/media runtime, audio tools, Python 3.11 from the AUR
sudo pacman -S pyside6 qt6-webengine python-psutil ffmpeg libpulse
paru -S python311   # or any AUR helper

git clone https://github.com/RenanZortea/speak-to-speech.git
cd speak-to-speech
python3.11 -m venv .venv

# Python deps — same pins as Windows
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/pip install faster-whisper==1.2.1 ctranslate2==4.7.2
.venv/bin/pip install "nvidia-cublas-cu12==12.9.*" "nvidia-cudnn-cu12==9.*"

cd frontend && npm install && cd ..
```

Run it the same way as Windows — dev mode with two terminals
(`npm run dev` + `.venv/bin/python backend/main.py --dev`), or build once and run
`.venv/bin/python backend/main.py`.

Linux notes:

- **No CUDA preload dance.** The nvidia-cu12 wheels are found by the regular
  dynamic linker; `worker.py`'s Windows DLL preload is skipped on Linux.
- **In-app updater is Windows-only** (it downloads the Setup.exe). On Linux,
  update with `git pull` + `npm run build`.

## First launch

1. Window opens, top-right shows GPU status (`CUDA × 1` if all good).
2. If no Whisper model is downloaded, you'll see a "Download model" screen.
   The default Hebrew model is ~3 GB.
3. First transcription pays a ~10s model-load cost; subsequent ones don't.

**Slow downloads?** HuggingFace rate-limits anonymous requests. A free `HF_TOKEN`
from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
can be supplied through the environment before launching:

```powershell
$env:HF_TOKEN = "hf_yourtokenhere"
```

## Building a portable bundle (for distribution)

Produces a self-contained `dist/SpeakToSpeech/` folder + a portable ZIP. The
bundle includes Python, faster-whisper, the CUDA runtime DLLs, the
built React frontend, and Qt WebEngine. The Whisper model is downloaded
separately on first launch.

```powershell
.\build.ps1
```

Options:

- `-VenvPython "C:\path\to\python.exe"` — use a non-default venv
- `-SkipFrontend` — reuse an existing `frontend/dist/`
- `-SkipZip` — produce the folder bundle only, skip ZIP packaging
- `-Clean` — wipe `build/` and `dist/` before building

The end-to-end build runs the React production build, invokes PyInstaller via
[`SpeakToSpeech.spec`](SpeakToSpeech.spec), and zips the result. First build
takes 3–6 minutes; subsequent ones are faster (incremental analysis cache).

To distribute, send users the resulting `dist/SpeakToSpeech-portable-<date>.zip`.
They extract anywhere and double-click `SpeakToSpeech.exe`.

## Architecture

The app uses **Python + faster-whisper + PySide6/Qt WebEngine + React +
wavesurfer.js**. The Qt desktop shell runs separately from the transcription
backend, communicating through a local server and a Qt WebChannel bridge.
The embedded YouTube view has a separate browser profile.

```text
backend/
├── main.py            App API and backend lifecycle
├── desktop_shell.py   Qt window, frontend bridge, embedded media view
├── desktop_server.py  Local frontend, RPC, and event server
├── media_browser.py   YouTube playback and sign-in
├── native_audio.py    Native recording and audio routing
├── worker.py          Whisper transcription and model switching
├── model_manager.py   Model catalog and downloads
└── audio_server.py    Seekable audio streaming

frontend/src/
├── App.tsx            Workspaces, sessions, and event wiring
├── MediaWidget.tsx    Media source and player
├── VowelStudio.tsx    Vowel exploration and practice
├── formantTracker.ts  Microphone and playback vowel analysis
├── AudioBar.tsx       Waveform and playback controls
├── Recorder.tsx       Recording controls
└── api.ts             Typed backend bridge
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for the Whisper inference runtime
- [ivrit-ai](https://huggingface.co/ivrit-ai) for the Hebrew Whisper fine-tune
- [Qt for Python](https://doc.qt.io/qtforpython-6/) for the desktop shell and embedded browser
- [wavesurfer.js](https://wavesurfer-js.org/) for the waveform rendering
- [Lucide](https://lucide.dev/) for the icons

### Recording a conversation

Open the microphone icon in the bottom-right corner and choose **Microphone**,
**Desktop audio**, or **Desktop + microphone**. On Linux, choose the desktop
output your conversation app plays through, and choose your microphone for the
combined mode. Headphones avoid recording the remote voice again through your
microphone. Changes apply to the next recording; Stop prepares the audio for
playback/transcription, and Discard removes it.

The Linux desktop app uses PipeWire's PulseAudio service (or PulseAudio), `pactl`
from `libpulse`, and `ffmpeg`. The speaker icon routes this app's playback,
including embedded video, without changing other applications or system defaults.
Native recordings show elapsed time; the live waveform preview is available for
browser recording streams. Restart the desktop app after updating the backend.

Other environments use the browser's audio APIs. Desktop recording asks you to
share a screen or tab with audio enabled; [audio capture availability depends on
the browser and selected source](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
If no audio track is shared, recording stops with an explanation. Browser speaker
selection applies to recorded/imported audio and reports permission or device
errors before saving a choice.

### Qt media browser

Install/update `backend/requirements.txt` in the same Python environment used by the app, then restart the desktop app. PySide6 supplies Qt WebEngine. On Linux, the launcher prefers `/usr/bin/python` when it has PySide6/Qt ≥6.8 and psutil, because distribution Qt builds can supply AAC/H.264 codecs missing from PyPI wheels. Otherwise it uses the app’s Python. Set `SPEAKTOSPEECH_BROWSER_PYTHON` to select a specific browser runtime; frozen builds use their bundled runtime. The Qt shell runs separately from the transcription backend. Its local app page and media view are native children of the same window. Only the local app page has a Python bridge; website pages use a separate profile and have no backend API access.

For standalone testing:

```sh
.venv/bin/python backend/media_browser.py --url https://www.youtube.com/
```

The desktop Media panel is a focused player, not a general-purpose browser. Its **Sign in** action opens a separate account window, sharing the website profile under `~/SpeakToSpeech/media-browser/`. Account navigation is limited to YouTube authentication routes and Google account/consent hosts; account pages never receive the application bridge. Closing sign-in reloads the selected video. Some identity providers may reject embedded browsers; successful authentication must be checked on the target machine. The app's sign-in button is styled to match the UI; credential forms remain the provider's own pages.

In-app playback uses the original HTML video element and best-effort controls, so YouTube site changes may require updates. Test real playback, login persistence after restarting, and recorded audio on the target machine. Browser-only frontend mode opens video links externally. The standalone browser command above remains a developer tool with navigation controls.

Browser smoke test (generated local media, temporary profile):

```sh
QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu python tests/qt_desktop_smoke.py
```

The smoke test requires PySide6 and psutil. Chromium’s sandbox remains enabled; run it outside restrictive tool/container sandboxes.
