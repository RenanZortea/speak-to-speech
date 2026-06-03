"""
Pronunciation analysis worker.

Uses facebook/wav2vec2-xlsr-53-espeak-cv-ft (a multilingual phoneme CTC model)
to recognize the phonemes actually present in an audio clip, with a per-phoneme
confidence derived from the CTC posteriors. Low confidence ~ the model was
unsure about that sound = a candidate mispronunciation / unclear articulation.

Design notes:
  - We bypass the HF *tokenizer* (it needs phonemizer/espeak). We only need the
    feature extractor (audio normalization) + vocab.json (id -> phoneme symbol).
  - Loading is forced offline (local_files_only) so transformers doesn't make a
    blocking network call to the HF Hub on every load.
  - torch is CPU-only here. Inference is ~4-5x realtime on CPU, which is fine for
    occasional analysis. (CTranslate2/Whisper keeps the GPU.)
  - wav2vec2's conv feature extractor downsamples 16kHz audio by 320x, so each
    output frame corresponds to exactly 20ms. That gives us phoneme timestamps.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from orchestration import ModelHost

PRON_MODEL_ID = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
SAMPLE_RATE = 16000
FRAME_SECONDS = 0.02  # 320-sample stride at 16kHz


def _to_wav16k(src: str) -> str:
    """Convert any audio to 16kHz mono wav via ffmpeg; return temp path."""
    out = Path(tempfile.gettempdir()) / "stt_pronunciation.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", str(SAMPLE_RATE), "-ac", "1", str(out)],
        check=True,
        capture_output=True,
    )
    return str(out)


class PronunciationWorker(ModelHost):
    id = "pronunciation"
    device = "cpu"

    def __init__(self):
        super().__init__()
        self._fe = None
        self._id_to_tok = None
        self._blank_id = 0
        self.cpu_threads = None  # None → default (half cores); set by Api settings

    def _on_unload(self):
        self._fe = None
        self._id_to_tok = None

    def load(self):
        with self._lock:
            if self._model is not None:
                return
            import torch
            from huggingface_hub import hf_hub_download
            from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor

            threads = self.cpu_threads or max(1, (os.cpu_count() or 4) // 2)
            torch.set_num_threads(threads)

            self._fe = Wav2Vec2FeatureExtractor.from_pretrained(
                PRON_MODEL_ID, local_files_only=True
            )
            model = AutoModelForCTC.from_pretrained(PRON_MODEL_ID, local_files_only=True)
            model.eval()
            self._model = model

            vocab_path = hf_hub_download(PRON_MODEL_ID, "vocab.json", local_files_only=True)
            with open(vocab_path, encoding="utf-8") as f:
                vocab = json.load(f)  # phoneme -> id
            self._id_to_tok = {v: k for k, v in vocab.items()}
            self._blank_id = (
                model.config.pad_token_id if model.config.pad_token_id is not None else 0
            )

    def assess(self, audio_path: str, on_done, on_error, on_status=None):
        """
        Analyze pronunciation. Emits via callbacks:
          on_status({"status": "loading_model"|"converting"|"analyzing"})
          on_done({"phonemes": [...], "mean_confidence": float, "duration": float})
          on_error(str)

        Each phoneme: {"symbol", "start", "end", "confidence"}.
        """
        try:
            import torch

            if not self.is_loaded:
                if on_status:
                    on_status({"status": "loading_model"})
                self.load()

            if on_status:
                on_status({"status": "converting"})
            wav_path = _to_wav16k(audio_path)

            import soundfile as sf
            audio, sr = sf.read(wav_path, dtype="float32")
            duration = len(audio) / sr

            if on_status:
                on_status({"status": "analyzing"})
            inputs = self._fe(audio, sampling_rate=sr, return_tensors="pt", padding=True)
            with torch.no_grad():
                logits = self._model(inputs.input_values).logits  # [1, T, vocab]

            probs = torch.softmax(logits, dim=-1)[0]
            pred_ids = torch.argmax(logits, dim=-1)[0]
            conf_per_frame = probs.max(dim=-1).values

            phonemes = self._collapse(pred_ids.tolist(), conf_per_frame.tolist())
            mean_conf = (
                sum(p["confidence"] for p in phonemes) / len(phonemes)
                if phonemes
                else 0.0
            )
            on_done({
                "phonemes": phonemes,
                "mean_confidence": mean_conf,
                "duration": float(duration),
            })
        except Exception as e:
            on_error(str(e))

    def _collapse(self, ids, confs):
        """CTC collapse: merge repeated frames, drop blanks. Compute per-phoneme
        timestamps (from frame index) and confidence (mean over the run)."""
        phonemes = []
        run_start = None
        run_confs = []
        prev = None

        def flush(end_idx):
            if prev is not None and prev != self._blank_id and run_confs:
                phonemes.append({
                    "symbol": self._id_to_tok.get(prev, f"<{prev}>"),
                    "start": round(run_start * FRAME_SECONDS, 3),
                    "end": round(end_idx * FRAME_SECONDS, 3),
                    "confidence": round(sum(run_confs) / len(run_confs), 3),
                })

        for i, (fid, conf) in enumerate(zip(ids, confs)):
            if fid == prev:
                run_confs.append(conf)
            else:
                flush(i)
                prev = fid
                run_start = i
                run_confs = [conf]
        flush(len(ids))
        return phonemes
