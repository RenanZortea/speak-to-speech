"""
Accent analysis worker. Whole-clip categorical accent classification via the
vendored XLSR classifier (see accent_model.py). CPU torch, one forward pass,
serialized through the JobLane like PronunciationWorker.
"""
import os
import subprocess
import tempfile
from pathlib import Path

from orchestration import ModelHost

SAMPLE_RATE = 16000


def _to_wav16k(src: str) -> str:
    out = Path(tempfile.gettempdir()) / "stt_accent.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", str(SAMPLE_RATE), "-ac", "1", str(out)],
        check=True,
        capture_output=True,
    )
    return str(out)


class AccentWorker(ModelHost):
    id = "accent"
    device = "cpu"

    def __init__(self):
        super().__init__()
        self._loaded_id = None
        self.cpu_threads = None

    def _on_unload(self):
        self._loaded_id = None

    def load(self, model_desc: dict):
        with self._lock:
            if self._model is not None and self._loaded_id == model_desc["id"]:
                return
            import torch
            from accent_model import load_accent_classifier
            from app_settings import get_models_dir

            threads = self.cpu_threads or max(1, (os.cpu_count() or 4) // 2)
            torch.set_num_threads(threads)

            clf, _keys = load_accent_classifier(
                model_desc["id"], model_desc["backbone"],
                str(get_models_dir()), model_desc["num_labels"],
            )
            self._model = clf
            self._loaded_id = model_desc["id"]

    def classify(self, audio_path, model_desc, on_done, on_error, on_status=None):
        try:
            import torch

            if not self.is_loaded or self._loaded_id != model_desc["id"]:
                if on_status:
                    on_status({"status": "loading_model"})
                self.load(model_desc)

            if on_status:
                on_status({"status": "converting"})
            wav_path = _to_wav16k(audio_path)

            import soundfile as sf
            audio, sr = sf.read(wav_path, dtype="float32")

            if on_status:
                on_status({"status": "analyzing"})
            clf = self._model
            inputs = clf.feature_extractor(
                audio, sampling_rate=sr, return_tensors="pt", padding=True
            )
            logits = clf.forward(inputs.input_values, inputs.get("attention_mask"))
            probs = torch.softmax(logits, dim=-1)[0]

            ranked = sorted(
                ({"label": clf.labels[i], "prob": round(float(p), 4)}
                 for i, p in enumerate(probs.tolist())),
                key=lambda r: r["prob"], reverse=True,
            )
            on_done({
                "label": ranked[0]["label"],
                "confidence": ranked[0]["prob"],
                "probs": ranked,
                "model_id": model_desc["id"],
            })
        except Exception as e:
            on_error(str(e))
