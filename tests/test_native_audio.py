import sys
import shutil
import struct
import subprocess
import unittest
import tempfile
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from native_audio import NativeAudio, capture_command


class NativeAudioTests(unittest.TestCase):
    def test_capture_modes_select_only_requested_sources(self):
        for mode, expected in [("microphone", ["mic"]), ("desktop", ["monitor"]), ("both", ["monitor", "mic"])]:
            command = capture_command(mode, "mic", "monitor", "/tmp/output.wav")
            self.assertEqual([command[i + 1] for i, arg in enumerate(command) if arg == "-i"], expected)
            self.assertEqual("-filter_complex" in command, mode == "both")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required")
    def test_mix_preserves_microphone_level_with_video_audio(self):
        command = capture_command("both", "mic", "monitor", "/tmp/unused.wav")
        mix = command[command.index("-filter_complex") + 1]
        for desktop, microphone, expected in [(0, 0.2, 0.2), (0.4, 0.2, 0.4)]:
            result = subprocess.run([
                "ffmpeg", "-v", "error",
                "-f", "lavfi", "-i", f"aevalsrc={desktop}:s=48000:d=0.1",
                "-f", "lavfi", "-i", f"aevalsrc={microphone}:s=48000:d=0.1",
                "-filter_complex", mix, "-map", "[a]", "-f", "f32le", "pipe:1",
            ], check=True, capture_output=True)
            samples = struct.unpack(f"{len(result.stdout) // 4}f", result.stdout)
            self.assertTrue(samples)
            for sample in samples:
                self.assertAlmostEqual(sample, expected, places=5)

    @patch("native_audio.psutil.Process")
    @patch("native_audio.os.getpid", return_value=100)
    @patch("native_audio.pactl")
    @patch("native_audio.pulse_list")
    def test_routing_moves_only_this_apps_streams(self, listing, command, pid, process):
        child = type("Child", (), {"pid": 101})()
        process.return_value.children.return_value = [child]
        listing.side_effect = [[{"name": "headset", "index": 8}], [
            {"index": 1, "sink": 2, "properties": {"application.process.id": "100"}},
            {"index": 2, "sink": 2, "properties": {"application.process.id": "101"}},
            {"index": 3, "sink": 2, "properties": {"application.process.id": "999"}},
            {"index": 4, "sink": 8, "properties": {"application.process.id": "101"}},
        ]]
        NativeAudio()._route("headset")
        self.assertEqual([call.args for call in command.call_args_list], [
            ("move-sink-input", "1", "headset"), ("move-sink-input", "2", "headset"),
        ])

    @patch("native_audio.pulse_list", return_value=[])
    def test_missing_output_is_rejected_without_saving_it(self, listing):
        audio = NativeAudio()
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            audio.set_output("unplugged")
        self.assertIsNone(audio._output)
        self.assertIsNone(audio._router)

    def test_rejects_invalid_recording_mode_before_starting(self):
        with self.assertRaisesRegex(ValueError, "Unknown recording source"):
            NativeAudio().start("invalid")

    def test_cannot_stop_a_recording_that_never_started(self):
        with self.assertRaisesRegex(RuntimeError, "No active recording"):
            NativeAudio().stop()


class RecordingPauseTests(unittest.TestCase):
    def test_merge_preserves_only_recorded_frames_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / f"{i}.wav" for i in range(3)]
            for index, path in enumerate(paths):
                with wave.open(str(path), "wb") as output:
                    output.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
                    output.writeframes(struct.pack("<10h", *([index + 1] * 10)))
            audio = NativeAudio()
            audio._parts = paths[:-1]
            audio._path = paths[-1]
            try:
                audio._merge_parts()
                with wave.open(str(audio._path)) as result:
                    self.assertEqual(result.getnframes(), 30)
                    self.assertEqual(struct.unpack("<30h", result.readframes(30)),
                                     tuple([1] * 10 + [2] * 10 + [3] * 10))
                self.assertTrue(all(not path.exists() for path in paths))
            finally:
                audio._discard()

    def test_pause_requires_active_recording(self):
        with self.assertRaisesRegex(RuntimeError, "No active recording"):
            NativeAudio().pause()
