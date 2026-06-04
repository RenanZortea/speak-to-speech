import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import {
  CATEGORY_LABEL,
  CORRECTION_CATEGORIES,
  type Correction,
  type CorrectionCategory,
} from "./corrections";

export type DialogTarget = {
  from: number;
  to: number;
  original: string;
  existing: Correction | null;
};

interface Props {
  target: DialogTarget;
  onSave: (data: {
    suggestion: string;
    category: CorrectionCategory;
    explanation: string;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CorrectionDialog({ target, onSave, onDelete, onClose }: Props) {
  const existing = target.existing;
  const [suggestion, setSuggestion] = useState(existing?.suggestion ?? "");
  const [category, setCategory] = useState<CorrectionCategory>(
    existing?.category ?? "grammar",
  );
  const [explanation, setExplanation] = useState(existing?.explanation ?? "");

  const save = () => {
    if (!suggestion.trim()) return;
    onSave({ suggestion: suggestion.trim(), category, explanation: explanation.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal correction-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
        <h2>{existing ? "Edit correction" : "Add correction"}</h2>

        <div className="cd-field">
          <label>Original</label>
          <div className="cd-original" dir="rtl">{target.original}</div>
        </div>

        <div className="cd-field">
          <label>Correction</label>
          <input
            autoFocus
            dir="auto"
            className="cd-input"
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onClose();
            }}
            placeholder="How it should be said…"
          />
        </div>

        <div className="cd-field">
          <label>Category</label>
          <select
            className="cd-select"
            value={category}
            onChange={(e) => setCategory(e.target.value as CorrectionCategory)}
          >
            {CORRECTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="cd-field">
          <label>Note (optional)</label>
          <textarea
            className="cd-textarea"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={2}
            placeholder="Why — the rule, the meaning, etc."
          />
        </div>

        <div className="cd-actions">
          {existing && (
            <button className="btn ghost danger" onClick={onDelete}>
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
          <div className="cd-actions-right">
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={!suggestion.trim()}>
              {existing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
