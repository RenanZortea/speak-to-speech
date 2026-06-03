"""
System resource monitoring — CPU / RAM (psutil) + GPU / VRAM (NVML).

A background poller emits a stats dict on an interval; the UI draws bars.
NVML is initialized once and cached; if there's no NVIDIA GPU it degrades to
{"available": False} silently.
"""
import os
import threading

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
