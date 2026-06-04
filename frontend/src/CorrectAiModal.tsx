import { useMemo, useState } from "react";
import { X, Copy, Check, Sparkles, AlertCircle } from "lucide-react";
import type { Segment } from "./api";
import type { Correction } from "./corrections";
import {
  buildCorrectionPrompt,
  mapAiCorrections,
  parseAiJson,
  type UnplacedCorrection,
} from "./aiCorrect";

interface Props {
  segments: Segment[];
  languageName: string;
  onApply: (corrections: Correction[]) => void;
  onClose: () => void;
}

export function CorrectAiModal({ segments, languageName, onApply, onClose }: Props) {
  const prompt = useMemo(
    () => buildCorrectionPrompt(segments, languageName),
    [segments, languageName],
  );
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; unplaced: UnplacedCorrection[] } | null>(
    null,
  );

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const apply = () => {
    setError(null);
    try {
      const json = parseAiJson(paste);
      const { corrections, unplaced } = mapAiCorrections(json, segments);
      if (corrections.length === 0 && unplaced.length === 0) {
        setError("No corrections found in the pasted JSON.");
        return;
      }
      onApply(corrections);
      setResult({ added: corrections.length, unplaced });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
        <h2>
          <Sparkles size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
          Correct with AI
        </h2>
        <p className="modal-sub">
          Copy the prompt into any AI (ChatGPT, Claude, …), then paste its JSON reply back.
          Works with any model — the app maps the corrections onto your transcript.
        </p>

        <div className="ai-step">
          <div className="ai-step-head">
            <span className="ai-step-num">1</span>
            <span>Copy this prompt and paste it into your AI</span>
            <button className="btn ghost ai-copy" onClick={copyPrompt}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <textarea className="ai-prompt" readOnly value={prompt} rows={6} />
        </div>

        <div className="ai-step">
          <div className="ai-step-head">
            <span className="ai-step-num">2</span>
            <span>Paste the AI's JSON reply here</span>
          </div>
          <textarea
            className="ai-paste"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setResult(null);
              setError(null);
            }}
            rows={6}
            placeholder='{ "corrections": [ … ] }'
          />
        </div>

        {error && (
          <div className="ai-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {result && (
          <div className="ai-result">
            <Check size={14} /> Added {result.added} correction{result.added === 1 ? "" : "s"}.
            {result.unplaced.length > 0 && (
              <span className="ai-unplaced">
                {" "}
                {result.unplaced.length} couldn't be placed (quote not found in its segment).
              </span>
            )}
          </div>
        )}

        <div className="ai-actions">
          <button className="btn ghost" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          <button className="btn primary" onClick={apply} disabled={!paste.trim()}>
            Apply corrections
          </button>
        </div>
      </div>
    </div>
  );
}
