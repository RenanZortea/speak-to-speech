import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from session_store import SessionStore


class SessionAutosaveTests(unittest.TestCase):
    def test_audio_only_session_survives_removing_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "recording.webm"
            source.write_bytes(b"recorded audio")
            store = SessionStore(root / "saved")
            summary = store.save_session({"audio_path": str(source), "segments": []})
            source.unlink()
            session = store.load_session(summary["id"])
            self.assertEqual(Path(session["audio_stored_path"]).read_bytes(), b"recorded audio")
            self.assertEqual(session["segments"], [])

    def test_update_keeps_audio_and_latest_transcript_without_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "recording.webm"
            source.write_bytes(b"recorded audio")
            store = SessionStore(root / "saved")
            summary = store.save_session({"audio_path": str(source), "segments": []})
            segments = [{"start": 0, "end": 1, "text": "Hello"}]
            updated = store.update_session(summary["id"], {"segments": segments})
            self.assertEqual(updated["segments"], segments)
            self.assertTrue(Path(updated["audio_stored_path"]).is_file())
            self.assertEqual(len(store.list_sessions()), 1)

    def test_copy_failure_does_not_report_saved_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "recording.webm"
            source.write_bytes(b"recorded audio")
            store = SessionStore(root / "saved")
            with patch("session_store.shutil.copy2", side_effect=OSError("disk full")):
                with self.assertRaisesRegex(OSError, "disk full"):
                    store.save_session({"audio_path": str(source), "segments": []})
            self.assertEqual(store.list_sessions(), [])
            self.assertEqual(list((root / "saved" / "sessions").iterdir()), [])

    def test_missing_audio_does_not_report_success(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(Path(directory) / "saved")
            with self.assertRaises(FileNotFoundError):
                store.save_session({"audio_path": str(Path(directory) / "missing.wav"), "segments": []})
            self.assertEqual(store.list_sessions(), [])


if __name__ == "__main__":
    unittest.main()
