# ArchPackage.md — porting SpeakToSpeech to Arch Linux

Tracks the effort to get SpeakToSpeech running on Arch (this dev machine first),
and later, packaging it properly. Not a design doc — just a running checklist +
findings log so we don't re-derive context each session.

## Scope

**Phase 1 (now): run from source on Arch**, dev-loop parity with the existing
Windows dev workflow (`npm run dev` + `python backend/main.py --dev`). No
installer, no AppImage — just make the app launch and work correctly.

**Phase 2 (later, optional): distributable package.** AUR PKGBUILD is the
natural fit for Arch (no installer/updater needed — pacman handles it). Only
worth doing if we decide to actually publish a Linux release.

## Status: Phase 1 — DONE (v0.6.0, then post-release UI fixes in v0.6.1,
2026-07-02). Phase 2 (AUR packaging) not started.

## Post-release UI fixes (v0.6.1)

Found while actually using the app on Arch after v0.6.0:

- Modals clipped instead of scrolling on a short window (`.settings-body`,
  esp. the update box, got cut off with no way to reach it). Fixed:
  `.settings-body` scrolls internally; `.modal` got an `overflow-y: auto`
  fallback so the AI-correct/correction dialogs (same latent bug) are covered
  too.
- Custom HF repo ID downloads never showed up in the model list — `list_models()`
  only ever returned the hardcoded `CATALOG`, so a downloaded custom model had
  no card and no way to select it. Fixed: one `scan_cache_dir` pass now appends
  any cached repo not in `CATALOG` as a `type: "custom"` entry (pronunciation
  model excluded by ID).
- "No model downloaded" was a full-screen blocker with no way to look around
  the app first. Replaced with a dismissible corner card (`.model-notice`) —
  app renders normally behind it; closing it just hides it until the model
  goes missing again (fresh launch, or deleted mid-session).

## Phase 1 checklist — run from source

- [x] Audit backend for Windows-only code (done 2026-07-02, see findings below)
- [x] Guard `worker.py`'s CUDA DLL preload block behind `sys.platform == "win32"`
      (done 2026-07-02 — was calling `ctypes.WinDLL` / `os.add_dll_directory`,
      both Windows-only, which would crash at import time on Linux)
- [x] System deps installed: `webkit2gtk-4.1` (pacman), AUR `python311` (via paru).
      Already had `gtk3`, `python-gobject`, `ffmpeg` (n8.1.2), `nvidia-smi`
      (RTX 2060 6GB, driver 610.43.02).
- [x] Python 3.11 installed via AUR (`python3.11` → 3.11.14).
- [x] Linux venv created at `.venv/` (gitignored) with `python3.11 -m venv .venv`.
      Installed: `backend/requirements.txt`, pinned
      `faster-whisper==1.2.1 ctranslate2==4.7.2`,
      `nvidia-cublas-cu12==12.9.* nvidia-cudnn-cu12==9.*`, plus pronunciation deps
      `torch` (CPU wheel, `--index-url https://download.pytorch.org/whl/cpu`),
      `transformers`, `soundfile`. No pin source found for the latter three (not
      in README or docs/) — installed latest, `pip check` reports no conflicts.
- [x] `pywebview>=5.0` did NOT drag in GTK bindings on its own — had to
      separately `pip install pycairo PyGObject` into the venv (built from
      source against the system's gobject-introspection/cairo dev headers,
      worked without extra system packages). Confirmed
      `gi.require_version('WebKit2', '4.1'); from gi.repository import Gtk, WebKit2`
      imports cleanly.
- [x] Verified CTranslate2 finds CUDA libs on Linux with **zero** manual preload
      — `ctranslate2.get_cuda_device_count()` → `1` right after
      `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`, no LD_LIBRARY_PATH
      tweaking needed. Confirms the Linux branch of the DLL-preload guard added
      to `worker.py` is correct: nothing to do there at all.
- [x] Backend module import smoke test passes (`worker`, `pronunciation`, `main`
      all import clean under the venv).
- [x] Frontend: `npm install` + `npm run dev` work unmodified (Vite 5.4.21, boots
      in ~150ms). No frontend changes needed for Linux.
- [x] Full windowed smoke test — works (verified by Renan in his own terminal,
      2026-07-02). Took two real fixes, both now in the codebase:
      1. **Wayland crash** (`Error 71 (Protocol error) dispatching to Wayland
         display`): WebKitGTK's DMA-BUF renderer is broken on the proprietary
         NVIDIA driver (same bug Tauri apps hit). Fix: `main.py` now auto-sets
         `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux when `/proc/driver/nvidia`
         exists (setdefault, so overridable).
      2. **Blank window / empty `#root`** after that: pywebview's
         `private_mode` defaults to True, and the GTK backend implements it by
         setting WebKit's `enable-html5-local-storage=False` — which removes
         `window.localStorage` from JS entirely. `App.tsx` reads localStorage
         during first render → React crashed before painting. WebView2 keeps
         localStorage in private mode, so Windows never saw it. Fix:
         `webview.start(private_mode=False, storage_path=~/SpeakToSpeech/webview)`.
- [x] App verified working end-to-end on Arch/Hyprland/Wayland/NVIDIA (user
      confirmed, 2026-07-02).

## Phase 2 checklist — packaging

- [x] **Local-only PKGBUILD** (`packaging/arch/`), for personal `makepkg -si`
      use — not published/AUR, no `.SRCINFO`. `prepare()` snapshots tracked
      files via `git archive` (skips `.venv/`, `node_modules/`, `dist/`);
      `build()` runs `npm run build` + builds a fresh `python3.11` venv with
      the same pins as the README; `package()` installs to
      `/opt/speaktospeech` + `/usr/bin/speaktospeech` (launcher) +
      `.desktop`/icon (`packaging/arch/speaktospeech.png`, generated from
      `docs/icon-source.png` via `convert`). Built + verified 2026-07-02:
      3.6 GB installed, all deps already present as system packages so
      `makepkg` needed no interactive installs. **Remember to bump `pkgver`
      in `PKGBUILD` alongside `backend/version.py`** — it's not wired to
      read it automatically.
- [ ] Decide: publish to AUR vs AppImage, if ever wanted (leaning PKGBUILD/AUR
      if so — Arch-native, pacman handles updates so we can drop the custom
      updater on Linux entirely). Not needed for personal use, above covers it.
- [ ] `updater.py` expects a GitHub release `.exe`/`.zip` asset and shells out to
      run the installer. Interim guard added 2026-07-02:
      `download_and_run_installer` now refuses on non-Windows and tells the user
      to `git pull`. Update *checks* still run on Linux (harmless — shows the
      notes/link). A real Linux update story is still Phase 2 (AUR handles it).
      **Release-publishing gotcha:** the Windows updater polls `/releases/latest`,
      which skips pre-releases — so source-only Linux releases must be published
      as pre-releases, or Windows users get an update prompt with no installer.
- [ ] `build.ps1` / `installer.iss` are Windows-only (PowerShell + Inno Setup) —
      Linux packaging needs its own build steps, not a port of these
- [ ] If going PyInstaller route instead of PKGBUILD: `SpeakToSpeech.spec`'s
      `binaries=` logic is Windows-DLL-specific (globs `.dll`, checks
      `Lib/site-packages/nvidia`) — needs a Linux branch (`.so`, `lib/python3.11/site-packages`)

## Findings log

- **2026-07-09** — Two stacked GPU failures on Renan's Arch box after a Jul-8
  `pacman -Syu`; app showed a silent transcribe error + no telemetry.
  1. **NVML telemetry** → `LibRmVersionMismatch`: userspace nvidia driver
     upgraded `610.43.02 → .03` but the loaded kernel module was still `.02`
     (same error `nvidia-smi` threw). **Reboot** realigned them. Not an app bug.
  2. **Transcription** → `RuntimeError: Library libcublas.so.12 is not found or
     cannot be loaded`, thrown at `model.encode` (weights load fine; first GPU
     compute needs cuBLAS). Root cause: the earlier claim that CTranslate2 finds
     the pip `nvidia-*-cu12` wheel `.so`s "via RPATH/RUNPATH baked into the
     wheel" was **wrong** — `libctranslate2*.so` has no RPATH, and ctranslate2's
     `__init__.py` preload is `win32`-only. It worked pre-Jul-8 only because a
     system CUDA lib satisfied the loader; the `-Syu` removed/changed it (no
     `cuda` pkg installed, cuBLAS not in ldconfig). Confirmed the fix by
     preloading the wheel's `libcublas`/`libcudnn` (`ctypes.CDLL`, `RTLD_GLOBAL`)
     — added a `sys.platform == "linux"` branch to `worker.py` mirroring the
     Windows one. Both venvs (`.venv` and `/opt`) reproduced identically.

- **2026-07-02** — Audited `backend/` for platform-specific code.
  - `worker.py:25-58`: hard Windows-only. `ctypes.WinDLL` doesn't exist on
    Linux (AttributeError), `os.add_dll_directory` likewise. This is the *only*
    code that will actually crash on import on Linux — everything else in the
    backend is fine.
  - `session_store.py`: already cross-platform (`Path.home()`), no changes needed.
  - `updater.py`: assumes `.exe`/`.zip` GitHub release assets and runs the
    downloaded installer via `subprocess.Popen`. Only matters for Phase 2.
  - `main.py`: `webview.create_window(...)` / `webview.start(debug=dev)` has no
    explicit `gui=` override, so pywebview will auto-pick a backend — on Linux
    that means GTK (via `webkit2gtk`) or Qt, whichever is installed. No code
    changes needed here, just system packages.
  - `pronunciation.py`: uses `tempfile`, `subprocess` (ffmpeg), all cross-platform
    already. Loads `facebook/wav2vec2-xlsr-53-espeak-cv-ft` with
    `local_files_only=True` — fine as long as the HF cache is pre-populated
    (same requirement as Windows).
  - README.md already states "Linux/macOS *will* work in principle — the only
    Windows-specific code is the explicit CUDA DLL preload in `worker.py`" —
    matches what the audit found. README's pinned versions
    (`faster-whisper==1.2.1`, `ctranslate2==4.7.2`,
    `nvidia-cublas-cu12==12.9.*`, `nvidia-cudnn-cu12==9.*`) are a good starting
    point for the Linux venv, but pronunciation deps (torch/transformers/soundfile)
    aren't pinned there — need to check the Windows venv for exact versions.

- **2026-07-02** — Built the actual venv and ran smoke tests on this machine (RTX
  2060, Arch, Wayland/GNOME session).
  - System packages `webkit2gtk-4.1` and AUR `python311` installed with the
    user's own `sudo pacman` / `paru` (not run by me).
  - `python3.11 -m venv .venv` at repo root works cleanly; all pinned packages
    from README install without conflicts (`pip check` clean).
  - `PyGObject`/`pycairo` aren't declared as `pywebview` deps but are required
    for its GTK backend — had to install them explicitly. They built from
    source fine because Arch's `python-gobject`/`gtk3` packages bring the
    needed `girepository`/`cairo` dev headers system-wide already; a from-scratch
    Arch box would need `gobject-introspection` and `cairo` (dev) explicitly.
  - CTranslate2 GPU detection confirmed with **no** DLL-preload equivalent
    needed on Linux — validates the `sys.platform == "win32"` guard added to
    `worker.py` earlier today is sufficient (Linux needs literally nothing
    extra there).
  - Attempted full `--dev` launch through this coding session's own sandboxed
    Bash tool: pywebview correctly selects GTK, but WebKitGTK's internal
    process sandbox (it uses bubblewrap itself) conflicts with the outer
    session sandbox, producing `Gdk-Message: Error 71 (Protocol error)
    dispatching to Wayland display` and a WebKit network-process crash loop.
    Tried `WEBKIT_DISABLE_SANDBOX=1` and `dangerouslyDisableSandbox` — neither
    fully resolved it inside this harness (background GUI processes launched
    via the harness don't reliably inherit `DISPLAY`/`WAYLAND_DISPLAY`/dbus
    session state either). This is very likely specific to running a GUI app
    from *inside* an agentic coding session, not a real Linux-port issue —
    needs confirmation by running `.venv/bin/python backend/main.py --dev`
    from the user's own terminal (with `npm run dev` in a second terminal).

- **2026-08-09** — Pronunciation and accent analysis were removed from the app
  entirely (see the commit that deletes `backend/pronunciation.py`,
  `backend/accent*.py`, `frontend/src/PronunciationBar.tsx`, `AccentBar.tsx`,
  `alignment.ts`). The venv notes above are now over-specified: **`torch`,
  `transformers` and `soundfile` are no longer needed** — they were only ever
  pulled in for the wav2vec2 phoneme/accent models. A fresh Linux venv needs
  only `backend/requirements.txt` + `faster-whisper`/`ctranslate2`/the
  `nvidia-*-cu12` wheels + `pycairo`/`PyGObject`. Everything else in the entries
  above still holds; they're kept as-is as a record of the port.
