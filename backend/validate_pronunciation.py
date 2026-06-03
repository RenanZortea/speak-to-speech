"""
Validation/spike script — NOT part of the app. Answers one question:
does wav2vec2-xlsr-53-espeak-cv-ft produce sane Hebrew phonemes?

Usage:
    python validate_pronunciation.py "path\\to\\recording.webm"

Pipeline:
    ffmpeg → 16kHz mono wav → wav2vec2 CTC → phonemes + per-frame confidence.
Prints the recognized phoneme string and a per-phoneme confidence breakdown.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor

# Use a sane number of CPU threads (defaults can thrash or single-thread).
torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))

MODEL_ID = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
SAMPLE_RATE = 16000


def to_wav16k(src: str) -> str:
    """Convert any audio to 16kHz mono wav via ffmpeg; return temp path."""
    out = Path(tempfile.gettempdir()) / "stt_pron_validate.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", str(SAMPLE_RATE), "-ac", "1", str(out)],
        check=True,
        capture_output=True,
    )
    return str(out)


def main():
    if len(sys.argv) < 2:
        print("usage: validate_pronunciation.py <audio>")
        sys.exit(1)
    audio_in = sys.argv[1]

    print(f"Converting {audio_in} → 16kHz wav ...")
    wav_path = to_wav16k(audio_in)
    audio, sr = sf.read(wav_path, dtype="float32")
    print(f"Loaded {len(audio)/sr:.1f}s of audio at {sr}Hz")

    print(f"Loading model {MODEL_ID} ...")
    # Bypass the tokenizer (it requires phonemizer/espeak). We only need:
    #   - the feature extractor (audio normalization), and
    #   - vocab.json for id -> phoneme symbol mapping.
    fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL_ID)
    model = AutoModelForCTC.from_pretrained(MODEL_ID)
    model.eval()

    vocab_path = hf_hub_download(MODEL_ID, "vocab.json")
    with open(vocab_path, encoding="utf-8") as f:
        vocab = json.load(f)              # phoneme -> id
    id_to_tok = {v: k for k, v in vocab.items()}

    print(f"Running inference (torch threads={torch.get_num_threads()}) ...", flush=True)
    t0 = time.time()
    inputs = fe(audio, sampling_rate=sr, return_tensors="pt", padding=True)
    with torch.no_grad():
        logits = model(inputs.input_values).logits  # [1, T, vocab]
    print(f"Inference took {time.time()-t0:.1f}s", flush=True)

    probs = torch.softmax(logits, dim=-1)[0]          # [T, vocab]
    pred_ids = torch.argmax(logits, dim=-1)[0]        # [T]
    conf_per_frame = probs.max(dim=-1).values         # [T]

    # CTC collapse: merge repeats, drop blank/pad. Build phoneme string.
    blank_id = model.config.pad_token_id if model.config.pad_token_id is not None else 0
    collapsed = []
    prev_id = None
    for fid in pred_ids.tolist():
        if fid != prev_id and fid != blank_id:
            collapsed.append(id_to_tok.get(fid, f"<{fid}>"))
        prev_id = fid
    phoneme_str = " ".join(collapsed)
    print("\n=== Recognized phonemes (CTC decoded) ===")
    print(phoneme_str)

    print("\n=== Per-phoneme confidence (collapsed runs) ===")
    print(f"{'phoneme':>10} {'frames':>7} {'avg_conf':>9} {'max_conf':>9}")
    prev = None
    run_confs = []
    runs = []
    for fid, conf in zip(pred_ids.tolist(), conf_per_frame.tolist()):
        if fid == prev:
            run_confs.append(conf)
        else:
            if prev is not None and prev != blank_id:
                runs.append((id_to_tok.get(prev, f"<{prev}>"), run_confs))
            prev = fid
            run_confs = [conf]
    if prev is not None and prev != blank_id:
        runs.append((id_to_tok.get(prev, f"<{prev}>"), run_confs))

    for tok, confs in runs:
        avg = sum(confs) / len(confs)
        mx = max(confs)
        print(f"{tok:>10} {len(confs):>7} {avg:>9.3f} {mx:>9.3f}")

    print(f"\nTotal phonemes (non-blank runs): {len(runs)}")
    print(f"Mean confidence: {np.mean([sum(c)/len(c) for _, c in runs]):.3f}")


if __name__ == "__main__":
    main()
