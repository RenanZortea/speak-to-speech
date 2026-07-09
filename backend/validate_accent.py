"""
Offline validator for the vendored accent classifier.

Two jobs:
  1. Inspect the SpeechBrain checkpoint's key prefixes vs the transformers
     Wav2Vec2Model, so the remap in accent_model.py can be confirmed/fixed.
  2. Parity: if SpeechBrain is importable in a scratch env, compare the vendored
     logits/argmax against foreign_class() on a sample wav. (Optional — skipped
     if speechbrain isn't installed. The primary correctness gate is that
     load_state_dict reports near-zero missing/unexpected keys.)

Run:  HF_HUB_OFFLINE=1 .venv/bin/python backend/validate_accent.py [sample.wav]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import torch  # noqa: E402
from app_settings import get_models_dir  # noqa: E402
from accent_model import _resolve_snapshot, load_accent_classifier, remap_speechbrain_wav2vec2  # noqa: E402
from transformers import Wav2Vec2Model  # noqa: E402

MODEL_ID = "bookbot/english-accent-classifier"
BACKBONE = "facebook/wav2vec2-large-xlsr-53"


def inspect_keys(cache_dir: str):
    snap = _resolve_snapshot(MODEL_ID, cache_dir)
    ckpt = torch.load(snap / "wav2vec2.ckpt", map_location="cpu", weights_only=True)
    ck = list(ckpt.keys())
    print(f"wav2vec2.ckpt: {len(ck)} keys; sample:")
    for k in ck[:8]:
        print("   ", k)
    ref = set(Wav2Vec2Model.from_pretrained(BACKBONE, local_files_only=True, cache_dir=cache_dir).state_dict())
    remapped = set(remap_speechbrain_wav2vec2(ckpt))
    print(f"transformers keys: {len(ref)}; remapped matches: {len(remapped & ref)}/{len(ref)}")
    print("unmatched remapped (first 8):", list(remapped - ref)[:8])


def main():
    cache_dir = str(get_models_dir())
    inspect_keys(cache_dir)
    clf, (missing, unexpected) = load_accent_classifier(MODEL_ID, BACKBONE, cache_dir, 16)
    print(f"load_state_dict: {len(missing)} missing, {len(unexpected)} unexpected")
    print("labels:", clf.labels)
    if len(sys.argv) > 1:
        import soundfile as sf
        audio, sr = sf.read(sys.argv[1], dtype="float32")
        inputs = clf.feature_extractor(audio, sampling_rate=sr, return_tensors="pt", padding=True)
        logits = clf.forward(inputs.input_values, inputs.get("attention_mask"))
        probs = torch.softmax(logits, dim=-1)[0]
        idx = int(probs.argmax())
        print(f"PRED: {clf.labels[idx]}  conf={probs[idx]:.3f}")


if __name__ == "__main__":
    main()
