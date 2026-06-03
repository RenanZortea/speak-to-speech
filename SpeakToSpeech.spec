# SpeakToSpeech.spec — PyInstaller build spec.
# Driven by build.ps1; you can also run directly:
#     pyinstaller --noconfirm SpeakToSpeech.spec
#
# Output:
#   dist/SpeakToSpeech/                  ← onedir bundle
#   dist/SpeakToSpeech/SpeakToSpeech.exe ← the launcher

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
PROJECT_ROOT = Path(SPECPATH)
BACKEND = PROJECT_ROOT / "backend"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

if not FRONTEND_DIST.is_dir():
    raise SystemExit(
        "frontend/dist not found — run `npm run build` first, or use build.ps1 "
        "which handles it for you."
    )

# Active venv (this Python is the one PyInstaller runs under).
VENV_ROOT = Path(sys.executable).parent.parent
NVIDIA_ROOT = VENV_ROOT / "Lib" / "site-packages" / "nvidia"
if not NVIDIA_ROOT.is_dir():
    raise SystemExit(
        f"NVIDIA libs not found at {NVIDIA_ROOT}. Install with: "
        "pip install nvidia-cublas-cu12 nvidia-cudnn-cu12"
    )

# -----------------------------------------------------------------------------
# Binaries (DLLs + .pyd) to bundle
# -----------------------------------------------------------------------------
# Format: list of (source_path, destination_subdir_within_bundle)
binaries = []

# NVIDIA CUDA runtime DLLs. worker.py preloads these by absolute path, so the
# subfolder layout (`nvidia/cublas/bin/`, `nvidia/cudnn/bin/`) must match what
# worker.py expects under sys._MEIPASS.
for dll in (NVIDIA_ROOT / "cublas" / "bin").glob("*.dll"):
    binaries.append((str(dll), "nvidia/cublas/bin"))
for dll in (NVIDIA_ROOT / "cudnn" / "bin").glob("*.dll"):
    binaries.append((str(dll), "nvidia/cudnn/bin"))

# CTranslate2 + PyAV ship their own DLLs; PyInstaller's collect_dynamic_libs
# walks the wheel and picks them up.
binaries += collect_dynamic_libs("ctranslate2")
binaries += collect_dynamic_libs("av")

# -----------------------------------------------------------------------------
# Data files
# -----------------------------------------------------------------------------
datas = [
    # Built React frontend
    (str(FRONTEND_DIST), "frontend/dist"),
]

# faster-whisper has assets (mel filter banks, tokenizer files) under
# faster_whisper/assets/. huggingface_hub has small metadata files. webview
# ships its JS shims that the bridge needs at runtime.
datas += collect_data_files("faster_whisper")
datas += collect_data_files("huggingface_hub")
datas += collect_data_files("webview")
datas += collect_data_files("av")

# -----------------------------------------------------------------------------
# Hidden imports — modules PyInstaller's static analysis misses
# -----------------------------------------------------------------------------
hiddenimports = [
    # faster-whisper internals
    "faster_whisper",
    "faster_whisper.feature_extractor",
    "faster_whisper.tokenizer",
    "faster_whisper.transcribe",
    "faster_whisper.utils",
    "faster_whisper.vad",
    # CTranslate2 / PyAV / huggingface_hub
    "ctranslate2",
    "av",
    "huggingface_hub",
    "huggingface_hub.file_download",
    # pywebview Windows backend
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    # pythonnet (pywebview's CLR loader on Windows)
    "clr_loader",
    "clr_loader.types",
    # tokenizers (from faster_whisper)
    "tokenizers",
]

# -----------------------------------------------------------------------------
# Exclude heavyweight deps we don't use (keeps the bundle smaller).
# -----------------------------------------------------------------------------
excludes = [
    "torch", "torchaudio", "torchvision",
    "tensorflow", "jax", "jaxlib",
    "matplotlib", "pandas", "scipy", "sklearn",
    "PIL", "Pillow",
    "PyQt5", "PyQt6", "PySide2", "PySide6",
    "IPython", "ipykernel", "jupyter", "notebook",
    "pytest", "sphinx", "babel",
]

# -----------------------------------------------------------------------------
# Analysis / build
# -----------------------------------------------------------------------------
block_cipher = None

a = Analysis(
    [str(BACKEND / "main.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SpeakToSpeech",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,            # UPX breaks some CUDA / ctranslate2 DLLs.
    console=False,        # GUI app — no console window.
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon="docs/icon.ico",  # add when we have one
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="SpeakToSpeech",
)
