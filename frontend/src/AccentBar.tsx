import { Globe, Loader2, Download, Square, AlertCircle } from "lucide-react";
import type { AccentResult } from "./api";

export type AccentStatus =
  | "idle"
  | "loading_model"
  | "converting"
  | "analyzing"
  | "done"
  | "error";

interface Props {
  hasAudio: boolean;
  supported: boolean;            // an accent model exists for this session's language
  modelPresent: boolean | null;  // null until known
  downloadBytes: number | null;
  status: AccentStatus;
  result: AccentResult | null;
  error: string | null;
  onAnalyze: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
}

const MODEL_SIZE = 1_300_000_000;

export function AccentBar({
  hasAudio, supported, modelPresent, downloadBytes,
  status, result, error, onAnalyze, onDownload, onCancelDownload,
}: Props) {
  if (!hasAudio || !supported) return null;

  const analyzing =
    status === "loading_model" || status === "converting" || status === "analyzing";

  if (downloadBytes !== null) {
    return (
      <div className="pron-bar">
        <span className="pb-text">
          Downloading accent model… {fmtBytes(downloadBytes)} / ~1.3 GB
        </span>
        <div className="pb-progress">
          <div className="pb-progress-fill"
            style={{ width: `${Math.min(100, (downloadBytes / MODEL_SIZE) * 100)}%` }} />
        </div>
        <button className="btn ghost danger pb-btn" onClick={onCancelDownload}>
          <Square size={11} fill="currentColor" /><span>Cancel</span>
        </button>
      </div>
    );
  }

  if (modelPresent === false) {
    return (
      <div className="pron-bar">
        <span className="pb-text">Accent analysis needs a one-time model download (~1.3 GB).</span>
        <button className="btn primary pb-btn" onClick={onDownload}>
          <Download size={14} /><span>Download model</span>
        </button>
        {error && <span className="pb-error"><AlertCircle size={13} /> {error}</span>}
      </div>
    );
  }

  return (
    <div className="pron-bar">
      <button className="btn primary pb-btn" onClick={onAnalyze} disabled={analyzing}>
        {analyzing ? (
          <><Loader2 size={14} className="spin" /><span>{statusLabel(status)}</span></>
        ) : (
          <><Globe size={14} /><span>{result ? "Re-analyze accent" : "Analyze accent"}</span></>
        )}
      </button>

      {status === "error" && error && (
        <span className="pb-error"><AlertCircle size={13} /> {error}</span>
      )}

      {result && status === "done" && (
        <>
          <div className="pb-score">
            <span className="pb-score-label">Accent</span>
            <span className="pb-score-value">
              {result.label} · {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <div className="pb-weakest">
            {result.probs.slice(0, 3).map((p) => (
              <span key={p.label} className="pb-weakest-chip">
                <span className="pb-weakest-sym">{p.label}</span>
                <span className="pb-weakest-meta">{Math.round(p.prob * 100)}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function statusLabel(kind: string): string {
  if (kind === "loading_model") return "Loading model…";
  if (kind === "converting") return "Preparing audio…";
  if (kind === "analyzing") return "Analyzing…";
  return "Working…";
}

function fmtBytes(b: number): string {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
