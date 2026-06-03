"""
Whisper worker. Holds the model in memory across transcriptions.

CUDA DLL setup MUST run before importing faster_whisper, or CTranslate2
fails to find cublas/cudnn on Windows.

Why preload via ctypes.WinDLL with absolute paths instead of just
os.add_dll_directory? In a long-running app (especially after WebView2 /
pythonnet have initialized) the DLL search path can be reset by other
subsystems, breaking later LoadLibrary calls. Preloading by absolute path
puts the DLLs in the process's loaded-modules table, where the loader
checks first — making lookup immune to search-path changes.
"""
import ctypes
import gc
import os
import sys
import threading
from pathlib import Path
from typing import Optional

# Derive the nvidia DLL location from the active Python's venv. Works for any
# venv layout: <venv>/Scripts/python.exe → <venv>/Lib/site-packages/nvidia/...
# Override via WHISPER_NVIDIA_BASE env var if you have an unusual setup.
_NVIDIA_BASE = Path(
    os.environ.get(
        "WHISPER_NVIDIA_BASE",
        str(Path(sys.executable).parent.parent / "Lib" / "site-packages" / "nvidia"),
    )
)
_DLL_DIRS = [_NVIDIA_BASE / "cublas" / "bin", _NVIDIA_BASE / "cudnn" / "bin"]

# Keep handles alive at module level (some Python versions may treat the
# os.add_dll_directory return value as releasing the dir on GC).
_dll_dir_handles = []
for _d in _DLL_DIRS:
    if _d.exists():
        _dll_dir_handles.append(os.add_dll_directory(str(_d)))

# Preload by absolute path. Order matters: cublasLt before cublas; cudnn
# dependencies before cudnn.dll itself.
_PRELOAD = [
    _NVIDIA_BASE / "cublas" / "bin" / "cublasLt64_12.dll",
    _NVIDIA_BASE / "cublas" / "bin" / "cublas64_12.dll",
    _NVIDIA_BASE / "cudnn" / "bin" / "cudnn_graph64_9.dll",
    _NVIDIA_BASE / "cudnn" / "bin" / "cudnn_ops64_9.dll",
    _NVIDIA_BASE / "cudnn" / "bin" / "cudnn64_9.dll",
]
_loaded_dlls = []
for _p in _PRELOAD:
    if _p.exists():
        try:
            _loaded_dlls.append(ctypes.WinDLL(str(_p)))
        except OSError:
            pass  # some cudnn submodules may not be needed; let faster-whisper try later

class WhisperWorker:
    def __init__(self):
        self._model = None
        self._current_id: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def current_id(self) -> Optional[str]:
        return self._current_id

    def load(self, model_id: str):
        """Load `model_id`. If a different model is already loaded, unload it first
        (RTX 2060 has only 6 GB VRAM — loading on top would OOM)."""
        with self._lock:
            if self._model is not None and self._current_id == model_id:
                return
            if self._model is not None:
                del self._model
                self._model = None
                self._current_id = None
                gc.collect()
            from faster_whisper import WhisperModel
            self._model = WhisperModel(model_id, device="cuda", compute_type="float16")
            self._current_id = model_id

    def unload(self):
        with self._lock:
            if self._model is not None:
                del self._model
                self._model = None
                self._current_id = None
                gc.collect()

    def transcribe(
        self,
        audio_path: str,
        on_segment,
        on_done,
        on_error,
        on_status=None,
        model_id: str = "ivrit-ai/whisper-large-v3-ct2",
        temperature: float = 0.0,
        language: Optional[str] = "he",
    ):
        try:
            need_load = (not self.is_loaded) or self._current_id != model_id
            if need_load:
                if on_status:
                    on_status({"status": "loading_model", "model_id": model_id})
                self.load(model_id)
            if on_status:
                on_status({"status": "transcribing"})

            # Capture a local reference so a concurrent unload can't yank
            # the model out from under us mid-iteration.
            model = self._model
            if model is None:
                raise RuntimeError("model became unavailable during transcribe")

            segments, info = model.transcribe(
                audio_path,
                language=language,  # None → autodetect; "he"/etc → forced
                temperature=float(temperature),
                beam_size=5,
                vad_filter=False,
            )
            if on_status:
                on_status({
                    "status": "language_detected",
                    "language": getattr(info, "language", None),
                })
            for seg in segments:
                on_segment({
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "text": seg.text,
                    "avg_logprob": float(getattr(seg, "avg_logprob", 0.0) or 0.0),
                    "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
                })
            on_done({
                "duration": float(info.duration),
                "language": getattr(info, "language", None),
                "model_id": model_id,
            })
        except Exception as e:
            on_error(str(e))
