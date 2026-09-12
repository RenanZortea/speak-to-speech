"""Linux desktop capture and per-application output routing over PulseAudio/PipeWire."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave

import psutil


def pactl(*args):
    result = subprocess.run(["pactl", *args], capture_output=True, text=True, timeout=4)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Could not connect to the audio service.")
    return result.stdout.strip()


def pulse_list(kind):
    return json.loads(pactl("-f", "json", "list", kind))


def capture_command(mode, microphone, monitor, path):
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    sources = ([monitor] if mode != "microphone" else []) + ([microphone] if mode != "desktop" else [])
    for source in sources:
        command += ["-thread_queue_size", "512", "-f", "pulse", "-i", source]
    if len(sources) == 2:
        # Keep the microphone at its original level; the reference plays behind it.
        command += ["-filter_complex", "[0:a][1:a]amix=inputs=2:duration=longest:weights=0.5 1:normalize=0[a]", "-map", "[a]"]
    command += ["-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(path)]
    return command


class NativeAudio:
    def __init__(self):
        self._lock = threading.RLock()
        self._process = None
        self._path = None
        self._log = None
        self._output = None
        self._closed = threading.Event()
        self._router = None
        self._paused = False
        self._parts = []
        self._command = None

    def devices(self):
        if sys.platform != "linux":
            return {"supported": False}
        if not shutil.which("pactl"):
            return {"supported": False, "error": "Install libpulse (pactl) to select speakers and record desktop audio."}
        try:
            sinks = pulse_list("sinks")
            sources = pulse_list("sources")
            monitors = {sink["monitor_source"] for sink in sinks}
            return {
                "supported": True,
                "capture": bool(shutil.which("ffmpeg")),
                "outputs": [{"id": s["name"], "label": s.get("description", s["name"])} for s in sinks],
                "inputs": [{"id": s["name"], "label": s.get("description", s["name"])} for s in sources
                           if s["name"] not in monitors and s.get("properties", {}).get("device.class") != "monitor"],
            }
        except Exception as error:
            return {"supported": False, "error": str(error)}

    def _route(self, target):
        sink = target or pactl("get-default-sink")
        sinks = pulse_list("sinks")
        selected = next((s for s in sinks if s["name"] == sink), None)
        if selected is None:
            raise RuntimeError("Selected speaker is unavailable. Choose another output device.")
        pids = {str(os.getpid()), *(str(p.pid) for p in psutil.Process().children(recursive=True))}
        for stream in pulse_list("sink-inputs"):
            if (stream.get("properties", {}).get("application.process.id") in pids
                    and stream.get("sink") != selected["index"]):
                pactl("move-sink-input", str(stream["index"]), sink)

    def set_output(self, device):
        with self._lock:
            self._route(device)
            self._output = device
            if self._router is None:
                self._router = threading.Thread(target=self._route_loop, daemon=True)
                self._router.start()
        return {"ok": True}

    def _route_loop(self):
        # New WebKit streams appear when playback starts; route those too.
        while not self._closed.wait(0.5):
            try:
                with self._lock:
                    self._route(self._output)
            except Exception:
                pass  # Device unplugged; explicit selection reports errors to the UI.

    def start(self, mode, microphone="", desktop=""):
        with self._lock:
            if self._process is not None:
                raise RuntimeError("A recording is already active.")
            if mode not in {"microphone", "desktop", "both"}:
                raise ValueError("Unknown recording source.")
            devices = self.devices()
            if not devices.get("supported") or not devices.get("capture"):
                raise RuntimeError(devices.get("error") or "Install ffmpeg to record desktop audio.")
            if microphone and mode != "desktop" and microphone not in {s["id"] for s in devices["inputs"]}:
                raise RuntimeError("Selected microphone is unavailable.")
            monitor = ""
            if mode != "microphone":
                sink = desktop or pactl("get-default-sink")
                selected = next((s for s in pulse_list("sinks") if s["name"] == sink), None)
                if selected is None:
                    raise RuntimeError("Desktop audio device is unavailable.")
                monitor = selected["monitor_source"]
            fd, filename = tempfile.mkstemp(prefix="speaktospeech-recording-", suffix=".wav")
            os.close(fd)
            self._path = Path(filename)
            self._log = tempfile.TemporaryFile()
            try:
                self._process = subprocess.Popen(
                    capture_command(mode, (microphone or pactl("get-default-source")) if mode != "desktop" else "", monitor, self._path),
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self._log,
                )
                self._command = self._process.args
                time.sleep(0.25)
                if self._process.poll() is not None:
                    raise RuntimeError(self._error())
            except Exception:
                self._discard()
                raise
            return {"started": True}

    def _error(self):
        self._log.seek(0)
        return self._log.read().decode(errors="replace").strip()[-1500:] or "Audio capture stopped unexpectedly. Check the selected devices."

    def status(self):
        with self._lock:
            if self._process is not None and not self._paused and self._process.poll() is not None:
                message = self._error()
                self._discard()
                return {"error": message}
            return {"recording": self._process is not None, "paused": self._paused}

    def pause(self, paused=True):
        with self._lock:
            if self._process is None:
                raise RuntimeError("No active recording.")
            if bool(paused) == self._paused:
                return {"paused": self._paused}
            try:
                if paused:
                    self._finish_process()
                    if self._process.returncode != 0:
                        raise RuntimeError(self._error())
                    self._paused = True
                else:
                    fd, filename = tempfile.mkstemp(prefix="speaktospeech-recording-", suffix=".wav")
                    os.close(fd)
                    self._parts.append(self._path)
                    self._path = Path(filename)
                    self._log.close()
                    self._log = tempfile.TemporaryFile()
                    command = [*self._command[:-1], str(self._path)]
                    self._process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                                     stdout=subprocess.DEVNULL, stderr=self._log)
                    self._paused = False
                    time.sleep(0.25)
                    if self._process.poll() is not None:
                        raise RuntimeError(self._error())
                return {"paused": self._paused}
            except Exception:
                self._discard()
                raise

    def _merge_parts(self):
        if not self._parts:
            return
        fd, filename = tempfile.mkstemp(prefix="speaktospeech-recording-", suffix=".wav")
        os.close(fd)
        merged = Path(filename)
        try:
            with wave.open(str(merged), "wb") as output:
                for index, part in enumerate([*self._parts, self._path]):
                    with wave.open(str(part), "rb") as source:
                        if index == 0:
                            output.setparams(source.getparams())
                        while frames := source.readframes(48000):
                            output.writeframes(frames)
        except Exception:
            merged.unlink(missing_ok=True)
            raise
        for part in [*self._parts, self._path]:
            part.unlink(missing_ok=True)
        self._parts = []
        self._path = merged

    def _finish_process(self):
        process = self._process
        if process and process.poll() is None:
            try:
                process.communicate(b"q\n", timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise RuntimeError("Audio capture did not stop cleanly. Please record again.")

    def _discard(self):
        if self._process and self._process.poll() is None:
            self._process.kill()
            self._process.wait()
        if self._process and self._process.stdin:
            self._process.stdin.close()
        if self._log:
            self._log.close()
        if self._path:
            self._path.unlink(missing_ok=True)
        for part in self._parts:
            part.unlink(missing_ok=True)
        self._parts = []
        self._paused = False
        self._command = None
        self._process = self._path = self._log = None

    def stop(self, discard=False):
        with self._lock:
            if self._process is None:
                raise RuntimeError("No active recording.")
            try:
                self._finish_process()
                if discard:
                    return None
                if self._process.returncode != 0:
                    raise RuntimeError(self._error())
                self._merge_parts()
                with wave.open(str(self._path)) as audio:
                    if audio.getnframes() == 0:
                        raise RuntimeError("No audio was captured. Check the selected devices.")
                path = str(self._path)
                self._path = None  # Keep the completed file for playback/session saving.
                return path
            finally:
                self._discard()

    def close(self):
        self._closed.set()
        with self._lock:
            self._discard()
