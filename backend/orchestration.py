"""
Light orchestration for the local model "swarm".

Three small pieces, no framework:

  ModelHost        — common skeleton for a loadable model worker
                     (device, is_loaded, unload). Subclasses add their specifics.

  ResourceManager  — enforces "at most one GPU-resident model at a time".
                     A GPU worker calls claim_gpu(self) before loading; the
                     manager unloads any *other* registered GPU worker first.
                     On a 6 GB card this is the rail that keeps a future third
                     model (e.g. an LLM) from OOM-ing on top of Whisper.

  JobLane          — serializes heavy *compute* jobs (transcribe, pronounce, …)
                     so they never pile up or run concurrently. Emits a single
                     busy/idle signal the UI can trust. Downloads do NOT go
                     through here — they're I/O and run in their own subprocess.
"""
import gc
import threading
from typing import Callable, Optional


class ModelHost:
    """Base for a loadable model worker. Holds the model + a lock and provides
    a uniform unload(). Subclasses set `id`/`device`, implement loading, and
    override `_on_unload()` to clear any extra references they hold."""

    id: str = "model"
    device: str = "cpu"  # "cuda" | "cpu"

    def __init__(self):
        self._model = None
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def _on_unload(self) -> None:
        """Hook: subclass clears extra refs (feature extractor, vocab, etc.)."""

    def unload(self) -> None:
        with self._lock:
            if self._model is not None:
                del self._model
                self._model = None
                self._on_unload()
                gc.collect()


class ResourceManager:
    """Tracks GPU workers and guarantees only one is resident at a time."""

    def __init__(self):
        self._lock = threading.RLock()
        self._gpu_workers: list = []

    def register(self, worker: ModelHost) -> None:
        if worker.device == "cuda":
            with self._lock:
                if worker not in self._gpu_workers:
                    self._gpu_workers.append(worker)

    def claim_gpu(self, claimant: ModelHost) -> None:
        """Unload every *other* registered GPU worker before `claimant` loads."""
        with self._lock:
            for w in self._gpu_workers:
                if w is not claimant and w.is_loaded:
                    w.unload()

    def loaded_summary(self) -> dict:
        with self._lock:
            return {
                w.id: w.is_loaded
                for w in self._gpu_workers
            }


class JobLane:
    """Single-slot serializer for compute jobs. `try_run` returns False if a job
    is already running (caller should surface a 'busy' message). Emits state via
    the on_state callback: on_state(job_name | None)."""

    def __init__(self, on_state: Callable[[Optional[str]], None]):
        self._lock = threading.Lock()
        self._on_state = on_state
        self.current: Optional[str] = None

    @property
    def busy(self) -> bool:
        return self.current is not None

    def try_run(self, name: str, fn: Callable[[], None]) -> bool:
        if not self._lock.acquire(blocking=False):
            return False
        self.current = name
        try:
            self._on_state(name)
        except Exception:
            pass
        try:
            fn()
        finally:
            self.current = None
            try:
                self._on_state(None)
            except Exception:
                pass
            self._lock.release()
        return True
