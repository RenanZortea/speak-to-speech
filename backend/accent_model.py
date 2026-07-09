"""
Vendored accent classifier (no SpeechBrain framework).

Reimplements the bookbot/english-accent-classifier graph with plain torch +
transformers, so it loads offline and doesn't execute repo-shipped Python:

    Wav2Vec2Model(xlsr-53)  ->  masked mean-pool over time  [B, 1024]
      ->  Linear(1024 -> num_labels, bias=False)  ->  logits

The classifier head weights live in model.ckpt; the fine-tuned backbone weights
in wav2vec2.ckpt (a SpeechBrain checkpoint whose keys we remap). Labels come from
label_encoder.txt (SpeechBrain CategoricalEncoder text format).
"""
import re
from pathlib import Path


def parse_label_encoder(path: str) -> list[str]:
    """SpeechBrain CategoricalEncoder dump. Lines look like:  'us' => 0
    Returns labels ordered by index."""
    pairs: list[tuple[int, str]] = []
    line_re = re.compile(r"^'(?P<label>.+)'\s*=>\s*(?P<idx>\d+)\s*$")
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        m = line_re.match(raw.strip())
        if m:
            pairs.append((int(m.group("idx")), m.group("label")))
    pairs.sort(key=lambda p: p[0])
    return [label for _, label in pairs]


def remap_speechbrain_wav2vec2(state: dict) -> dict:
    """Map a SpeechBrain HuggingFaceWav2Vec2 checkpoint's keys onto a transformers
    Wav2Vec2Model state_dict. SpeechBrain wraps the HF model under a `model.`
    attribute, so its keys are typically prefixed `model.` (sometimes
    `wav2vec2.model.`). We strip that wrapper prefix; the remaining keys already
    match transformers Wav2Vec2Model. Task 2/Step 6 confirms the exact prefix
    against the real checkpoint and this function is adjusted if needed."""
    out: dict = {}
    for k, v in state.items():
        nk = k
        for prefix in ("wav2vec2.model.", "model.wav2vec2.", "model.", "wav2vec2."):
            if nk.startswith(prefix):
                nk = nk[len(prefix):]
                break
        out[nk] = v
    return out


def _resolve_snapshot(model_id: str, cache_dir: str) -> Path:
    """Locate the downloaded snapshot dir for a repo in the HF cache."""
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(model_id, local_files_only=True, cache_dir=cache_dir))


class AccentClassifier:
    """XLSR backbone + masked mean-pool + linear head. Not an nn.Module subclass
    to keep construction explicit; holds torch modules and runs them in forward()."""

    def __init__(self, backbone, head, labels, feature_extractor, output_norm: bool):
        self.backbone = backbone            # transformers Wav2Vec2Model (eval)
        self.head = head                    # torch.nn.Linear(hidden, num_labels, bias=False)
        self.labels = labels                # list[str], index-ordered
        self.feature_extractor = feature_extractor
        self.output_norm = output_norm      # SpeechBrain output_norm=True → layer_norm on encoder output

    def forward(self, input_values, attention_mask=None):
        import torch
        with torch.no_grad():
            hidden = self.backbone(input_values, attention_mask=attention_mask).last_hidden_state  # [B,T,H]
            if self.output_norm:
                hidden = torch.nn.functional.layer_norm(hidden, (hidden.shape[-1],))
            if attention_mask is not None:
                mask = attention_mask.unsqueeze(-1).to(hidden.dtype)  # [B,T,1]
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
            else:
                pooled = hidden.mean(dim=1)
            return self.head(pooled)  # [B, num_labels]


def load_accent_classifier(model_id: str, backbone: str, cache_dir: str, num_labels: int):
    """Build the vendored classifier from the downloaded snapshot, fully offline."""
    import torch
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2Model

    snap = _resolve_snapshot(model_id, cache_dir)

    fe = Wav2Vec2FeatureExtractor.from_pretrained(
        backbone, local_files_only=True, cache_dir=cache_dir
    )
    bb = Wav2Vec2Model.from_pretrained(
        backbone, local_files_only=True, cache_dir=cache_dir
    )

    # Fine-tuned backbone weights (SpeechBrain ckpt) override the base xlsr weights.
    # weights_only=True: these are pure tensor state dicts — never unpickle repo code
    # (the whole reason we vendor instead of using SpeechBrain's foreign_class).
    w2v_ckpt = torch.load(snap / "wav2vec2.ckpt", map_location="cpu", weights_only=True)
    remapped = remap_speechbrain_wav2vec2(w2v_ckpt)
    missing, unexpected = bb.load_state_dict(remapped, strict=False)
    # `missing`/`unexpected` should be near-empty once the remap is confirmed
    # (Task 2/Step 6). A large mismatch means the prefix map is wrong.
    bb.eval()

    hidden = bb.config.hidden_size  # 1024 for xlsr-53
    head = torch.nn.Linear(hidden, num_labels, bias=False)
    head_ckpt = torch.load(snap / "model.ckpt", map_location="cpu", weights_only=True)
    # model.ckpt is the head's state_dict; its single weight tensor is [num_labels, hidden].
    head_state = head_ckpt if isinstance(head_ckpt, dict) else {"weight": head_ckpt}
    # Normalize the key to "weight" regardless of SpeechBrain's naming.
    if "weight" not in head_state:
        only = next(v for v in head_state.values() if hasattr(v, "shape"))
        head_state = {"weight": only}
    head.load_state_dict(head_state)
    head.eval()

    labels = parse_label_encoder(str(snap / "label_encoder.txt"))
    return AccentClassifier(bb, head, labels, fe, output_norm=True), (missing, unexpected)
