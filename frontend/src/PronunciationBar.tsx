import {
  AudioWaveform,
  Download,
  Loader2,
  Square,
  AlertCircle,
} from "lucide-react";
import type { Phoneme } from "./api";
import {
  CATEGORY_LABELS,
  categoryColor,
  type Category,
} from "./alignment";
import type { CorrectionView } from "./CodeTranscript";

type PronStatus =
  | "idle"
  | "loading_model"
  | "converting"
  | "analyzing"
  | "done"
  | "error";

interface Props {
  hasAudio: boolean;
  modelPresent: boolean | null;
  downloadBytes: number | null;
  status: PronStatus;
  phonemes: Phoneme[];
  meanConfidence: number;
  floatingCount: number;
  error: string | null;
  hasCorrections: boolean;
  correctionView: CorrectionView;
  onCorrectionViewChange: (v: CorrectionView) => void;
  onAnalyze: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
}

const PRON_MODEL_SIZE = 1_260_000_000;
const LEGEND: Category[] = ["clear", "accent", "codeswitch", "gap"];

export function PronunciationBar({
  hasAudio,
  modelPresent,
  downloadBytes,
  status,
  phonemes,
  meanConfidence,
  floatingCount,
  error,
  hasCorrections,
  correctionView,
  onCorrectionViewChange,
  onAnalyze,
  onDownload,
  onCancelDownload,
}: Props) {
  if (!hasAudio) return null;

  const analyzing =
    status === "loading_model" || status === "converting" || status === "analyzing";
  const hasResult = status === "done" && phonemes.length > 0;

  const toggleEl = hasCorrections ? (
    <div className="corr-toggle">
      <button
        className={correctionView === "corrected" ? "active" : ""}
        onClick={() => onCorrectionViewChange("corrected")}
      >
        Corrected
      </button>
      <button
        className={correctionView === "original" ? "active" : ""}
        onClick={() => onCorrectionViewChange("original")}
      >
        Original
      </button>
    </div>
  ) : null;

  // Downloading the model
  if (downloadBytes !== null) {
    return (
      <div className="pron-bar">
        <span className="pb-text">
          Downloading pronunciation model… {fmtBytes(downloadBytes)} / ~1.2 GB
        </span>
        <div className="pb-progress">
          <div
            className="pb-progress-fill"
            style={{ width: `${Math.min(100, (downloadBytes / PRON_MODEL_SIZE) * 100)}%` }}
          />
        </div>
        <button className="btn ghost danger pb-btn" onClick={onCancelDownload}>
          <Square size={11} fill="currentColor" />
          <span>Cancel</span>
        </button>
      </div>
    );
  }

  // Model needs downloading
  if (modelPresent === false) {
    return (
      <div className="pron-bar">
        <span className="pb-text">
          Pronunciation analysis needs a one-time model download (~1.2 GB).
        </span>
        <button className="btn primary pb-btn" onClick={onDownload}>
          <Download size={14} />
          <span>Download model</span>
        </button>
        {error && (
          <span className="pb-error">
            <AlertCircle size={13} /> {error}
          </span>
        )}
        {toggleEl}
      </div>
    );
  }

  return (
    <div className="pron-bar">
      <button className="btn primary pb-btn" onClick={onAnalyze} disabled={analyzing}>
        {analyzing ? (
          <>
            <Loader2 size={14} className="spin" />
            <span>{statusLabel(status)}</span>
          </>
        ) : (
          <>
            <AudioWaveform size={14} />
            <span>{hasResult ? "Re-analyze pronunciation" : "Analyze pronunciation"}</span>
          </>
        )}
      </button>

      {status === "error" && error && (
        <span className="pb-error">
          <AlertCircle size={13} /> {error}
        </span>
      )}

      {hasResult && (
        <>
          <div className="pb-score">
            <span className="pb-score-label">Overall</span>
            <span className="pb-score-value" style={{ color: scoreColor(meanConfidence) }}>
              {Math.round(meanConfidence * 100)}%
            </span>
          </div>

          <WeakestSounds phonemes={phonemes} />

          {floatingCount > 0 && (
            <span className="pb-floating" title="Sounds in gaps between words (not assigned to a word)">
              {floatingCount} floating
            </span>
          )}

          <div className="pb-legend">
            {LEGEND.map((c) => (
              <span key={c} className="pb-legend-item" title={CATEGORY_LABELS[c]}>
                <span className="pb-legend-swatch" style={{ background: categoryColor(c) }} />
                {CATEGORY_LABELS[c]}
              </span>
            ))}
          </div>
        </>
      )}

      {toggleEl}
    </div>
  );
}

function WeakestSounds({ phonemes }: { phonemes: Phoneme[] }) {
  const map = new Map<string, { sum: number; n: number }>();
  for (const p of phonemes) {
    const e = map.get(p.symbol) ?? { sum: 0, n: 0 };
    e.sum += p.confidence;
    e.n += 1;
    map.set(p.symbol, e);
  }
  const rows = [...map.entries()]
    .map(([sym, { sum, n }]) => ({ sym, avg: sum / n, n }))
    .filter((r) => r.n >= 2)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <div className="pb-weakest">
      <span className="pb-weakest-label">Weakest:</span>
      {rows.map((r) => (
        <span key={r.sym} className="pb-weakest-chip" title={`${r.n} occurrences`}>
          <span className="pb-weakest-sym" style={{ color: scoreColor(r.avg) }}>
            {r.sym}
          </span>
          <span className="pb-weakest-meta">{Math.round(r.avg * 100)}%</span>
        </span>
      ))}
    </div>
  );
}

function scoreColor(c: number): string {
  if (c >= 0.7) return "#5ec47b";
  if (c >= 0.4) return "#e4b85e";
  return "#e2554a";
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
