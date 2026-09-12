"""
System resource monitoring — CPU / RAM (psutil) + GPU / VRAM (NVML).

A background poller emits a stats dict on an interval; the UI draws bars.
NVML is initialized once and cached; if there's no NVIDIA GPU it degrades to
{"available": False} silently.
"""
import ctypes
import gc
import os
import sys
import threading
from dataclasses import dataclass

import psutil

_proc = psutil.Process(os.getpid())

_nvml_handle = None
_nvml_failed = False


def _gpu_stats() -> dict:
    global _nvml_handle, _nvml_failed
    if _nvml_failed:
        return {"available": False}
    try:
        import pynvml
        if _nvml_handle is None:
            pynvml.nvmlInit()
            _nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(_nvml_handle)
        if isinstance(name, bytes):
            name = name.decode()
        mem = pynvml.nvmlDeviceGetMemoryInfo(_nvml_handle)
        util = pynvml.nvmlDeviceGetUtilizationRates(_nvml_handle)
        return {
            "available": True,
            "name": name,
            "gpu_util": int(util.gpu),
            "vram_used": int(mem.used),
            "vram_total": int(mem.total),
        }
    except Exception:
        _nvml_failed = True
        return {"available": False}


def available_ram() -> int:
    """Bytes of host RAM currently available (reclaimable), per psutil."""
    return int(psutil.virtual_memory().available)


@dataclass(frozen=True)
class ModelLoadMemoryBudget:
    ram_available: int
    swap_available: int

    @property
    def total_available(self) -> int:
        return self.ram_available + self.swap_available


def model_load_memory_budget() -> ModelLoadMemoryBudget:
    """Memory the model loader can allocate without invoking the OOM killer.

    Linux can satisfy anonymous allocations from RAM plus swap.  The old
    preflight considered RAM only, so it rejected large models on machines with
    ample swap (including zram) before CTranslate2 got a chance to load them.
    Other platforms keep the conservative RAM-only behavior.
    """
    ram = available_ram()
    swap = int(psutil.swap_memory().free) if sys.platform == "linux" else 0
    return ModelLoadMemoryBudget(ram_available=ram, swap_available=swap)


def reclaim_unused_process_memory() -> None:
    """Release unreachable objects and, on glibc Linux, free allocator arenas.

    Destroying a CTranslate2 model releases VRAM immediately but glibc can keep
    gigabytes of freed host allocations in the process.  ``malloc_trim`` returns
    those pages to the OS before the next model's memory preflight.
    """
    gc.collect()
    if sys.platform != "linux":
        return
    try:
        malloc_trim = ctypes.CDLL(None).malloc_trim
        malloc_trim(0)
    except (AttributeError, OSError):
        pass


def free_vram() -> int | None:
    """Bytes free on GPU 0, or None if there's no NVML/GPU. 'Free' already
    accounts for whatever else (desktop, browser, other models) is resident."""
    s = _gpu_stats()
    if not s.get("available"):
        return None
    return int(s["vram_total"]) - int(s["vram_used"])


def get_stats() -> dict:
    vm = psutil.virtual_memory()
    return {
        "cpu_percent": psutil.cpu_percent(interval=None),
        "cpu_count": psutil.cpu_count(),
        "ram_percent": vm.percent,
        "ram_used": int(vm.used),
        "ram_total": int(vm.total),
        "proc_ram": int(_proc.memory_info().rss),
        "gpu": _gpu_stats(),
    }


class ResourceMonitor:
    def __init__(self, emit, interval: float = 1.5):
        self._emit = emit
        self._interval = interval
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread is not None:
            return
        psutil.cpu_percent(interval=None)  # prime the delta baseline
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        # Emit once immediately so the footer populates fast.
        try:
            self._emit(get_stats())
        except Exception:
            pass
        while not self._stop.wait(self._interval):
            try:
                self._emit(get_stats())
            except Exception:
                pass

    def stop(self):
        self._stop.set()
