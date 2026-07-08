"""
Whisper worker. Holds the model in memory across transcriptions.

CUDA DLL setup MUST run before importing faster_whisper, or CTranslate2
fails to find cublas/cudnn on Windows. This preload is Windows-only: on
Linux, the nvidia-cu12 wheels' .so files are found via the standard dynamic
linker (RPATH/RUNPATH baked into the wheel), so no equivalent is needed.

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

from orchestration import ModelHost

if sys.platform == "win32":
    # Derive the NVIDIA DLL location.
    #   - Bundled (PyInstaller): DLLs live under sys._MEIPASS/nvidia/* (placed
    #     there by the .spec file's `binaries=` directive).
    #   - Dev: derived from the active venv's site-packages.
    #   - Override via WHISPER_NVIDIA_BASE if your layout is unusual.
    if "WHISPER_NVIDIA_BASE" in os.environ:
        _NVIDIA_BASE = Path(os.environ["WHISPER_NVIDIA_BASE"])
    elif getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        _NVIDIA_BASE = Path(sys._MEIPASS) / "nvidia"
    else:
        _NVIDIA_BASE = Path(sys.executable).parent.parent / "Lib" / "site-packages" / "nvidia"
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

# Host RAM to keep free on top of the model file itself (CUDA runtime + Python).
# Loading a CT2 model reads its whole model.bin into RAM before uploading to VRAM;
# without a preflight guard a near-full machine swaps/freezes ("PC almost crashed").
_RAM_HEADROOM = 700_000_000
# Free VRAM below which we shrink our footprint: int8 weights (~half) instead of
# float16, and greedy decode instead of beam search. Keeps large-v3 usable on a
# 6 GB card whose desktop/browser already ate a chunk, instead of OOMing.
_VRAM_TIGHT = 1_300_000_000


def _is_cuda_oom(exc: BaseException) -> bool:
    s = str(exc).lower()
    return "out of memory" in s or "cuda failed" in s or "cublas" in s


class WhisperWorker(ModelHost):
    id = "whisper"
    device = "cuda"

    def __init__(self, resource_manager=None):
        super().__init__()
        self._current_id: Optional[str] = None
        self._compute_type: Optional[str] = None
        self._rm = resource_manager
        if resource_manager is not None:
            resource_manager.register(self)

    @property
    def current_id(self) -> Optional[str]:
        return self._current_id

    def _on_unload(self):
        self._current_id = None

    def load(self, model_id: str, force_compute: Optional[str] = None):
        """Load `model_id`. If a different model is already loaded, unload it first
        (RTX 2060 has only 6 GB VRAM — loading on top would OOM). Also asks the
        resource manager to free the GPU of any *other* model first.

        Preflights host RAM (refuses rather than freezing the machine) and picks
        the compute type adaptively: full float16 when VRAM is roomy, int8_float16
        (~half the weights) when it's tight. `force_compute` overrides the pick
        (used by the OOM-retry path)."""
        # Free GPU of other models BEFORE taking our own lock (avoids deadlock;
        # claim_gpu may unload sibling workers which take their own locks).
        if self._rm is not None:
            self._rm.claim_gpu(self)
        with self._lock:
            if self._model is not None and self._current_id == model_id and force_compute is None:
                return
            if self._model is not None:
                del self._model
                self._model = None
                self._current_id = None
                self._compute_type = None
                gc.collect()

            from faster_whisper import WhisperModel
            from app_settings import get_models_dir
            from model_manager import model_size_on_disk
            from resources import available_ram, free_vram

            size = model_size_on_disk(model_id) or 3_000_000_000

            # Preflight host RAM. Reading model.bin needs ~its size in RAM before
            # it reaches VRAM; bail out with a clear message instead of thrashing.
            avail = available_ram()
            need = int(size * 1.1) + _RAM_HEADROOM
            if avail < need:
                raise MemoryError(
                    f"Not enough free RAM to load this model safely "
                    f"(~{need / 1e9:.1f} GB needed, {avail / 1e9:.1f} GB free). "
                    f"Close some apps (browser, etc.) and try again."
                )

            # Adaptive precision by free VRAM. int8 weights are ~half the size.
            fv = free_vram()
            compute = force_compute or "float16"
            if force_compute is None and fv is not None and fv < size + _VRAM_TIGHT:
                compute = "int8_float16"

            # Preflight VRAM: refuse if even the weights won't fit, rather than OOM.
            weights_need = size if compute == "float16" else size // 2
            if fv is not None and fv < weights_need + 400_000_000:
                raise MemoryError(
                    f"Not enough free VRAM to load this model "
                    f"(~{(weights_need + 400_000_000) / 1e9:.1f} GB needed, "
                    f"{fv / 1e9:.1f} GB free). Close other GPU apps and try again."
                )

            self._model = WhisperModel(
                model_id,
                device="cuda",
                compute_type=compute,
                download_root=str(get_models_dir()),
            )
            self._current_id = model_id
            self._compute_type = compute
            gc.collect()  # release the model-file read buffer promptly

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
        from resources import free_vram
        emitted = [0]  # shared across attempts so we only retry before any output

        def attempt(force_compute: Optional[str], beam_size: int):
            need_load = (not self.is_loaded) or self._current_id != model_id or force_compute
            if need_load:
                if on_status:
                    on_status({"status": "loading_model", "model_id": model_id})
                self.load(model_id, force_compute=force_compute)
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
                beam_size=beam_size,
                vad_filter=False,
                word_timestamps=True,  # per-word [start,end,probability] for pron pairing
            )
            if on_status:
                on_status({
                    "status": "language_detected",
                    "language": getattr(info, "language", None),
                })
            for seg in segments:
                words = []
                for w in (getattr(seg, "words", None) or []):
                    words.append({
                        "start": float(w.start),
                        "end": float(w.end),
                        "word": w.word,
                        "probability": float(getattr(w, "probability", 0.0) or 0.0),
                    })
                on_segment({
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "text": seg.text,
                    "avg_logprob": float(getattr(seg, "avg_logprob", 0.0) or 0.0),
                    "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
                    "words": words,
                })
                emitted[0] += 1
            return info

        try:
            # Greedy decode (beam 1) uses far less VRAM than beam search; use it
            # when the card is already tight or the model loaded in int8 mode.
            fv = free_vram()
            tight = (fv is not None and fv < _VRAM_TIGHT) or self._compute_type == "int8_float16"
            try:
                info = attempt(None, beam_size=1 if tight else 5)
            except Exception as e:
                # A VRAM OOM before any segment was emitted → retry once at the
                # smallest footprint (int8 weights + greedy). Safe: no duplicates.
                if _is_cuda_oom(e) and emitted[0] == 0:
                    if on_status:
                        on_status({"status": "low_memory_retry"})
                    self.unload()
                    gc.collect()
                    info = attempt("int8_float16", beam_size=1)
                else:
                    raise
            on_done({
                "duration": float(info.duration),
                "language": getattr(info, "language", None),
                "model_id": model_id,
            })
        except Exception as e:
            msg = str(e) or f"{type(e).__name__}"
            if _is_cuda_oom(e):
                msg = ("Ran out of GPU memory even after reducing settings. "
                       "Close other GPU apps (browser, etc.) and try again. "
                       f"[{msg}]")
            on_error(msg)
