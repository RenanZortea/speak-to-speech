import {
  AudioWaveform,
  Download,
  Loader2,
  AlertCircle,
  Square,
} from "lucide-react";
import type { Phoneme } from "./api";

type PronStatus =
  | "idle"
  | "loading_model"
  | "converting"
  | "analyzing"
  | "done"
  | "error";

interface Props {
  audioPath: string | null;
  currentTime: number;
  onSeek: (t: number) => void;
  // Lifted state (owned by App so it survives tab switches):
  modelPresent: boolean | null;
  downloadBytes: number | null;
  status: PronStatus;
  phonemes: Phoneme[];
  meanConfidence: number;
  error: string | null;
  onAnalyze: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
}

const PRON_MODEL_SIZE = 1_260_000_000; // ~1.2 GB

export function PronunciationView({
  audioPath,
  currentTime,
  onSeek,
  modelPresent,
  downloadBytes,
  status,
  phonemes,
  meanConfidence,
  error,
  onAnalyze,
  onDownload,
  onCancelDownload,
}: Props) {
  const analyzing =
    status === "loading_model" || status === "converting" || status === "analyzing";

  if (!audioPath) {
    return (
      <div className="pron-view">
        <div className="pron-empty">
          <span>Pick a file or record on the Transcribe tab first, then analyze pronunciation here.</span>
        </div>
      </div>
    );
  }

  if (modelPresent === null) {
    return (
      <div className="pron-view">
        <div className="pron-empty">
          <Loader2 size={16} className="spin" /> <span>Checking model…</span>
        </div>
      </div>
    );
  }

  if (downloadBytes !== null) {
    return (
      <div className="pron-view">
        <div className="pron-panel">
          <p>Downloading pronunciation model… {fmtBytes(downloadBytes)} / ~1.2 GB</p>
          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(100, (downloadBytes / PRON_MODEL_SIZE) * 100)}%` }}
            />
          </div>
          <button className="btn ghost danger" onClick={onCancelDownload}>
            <Square size={12} fill="currentColor" />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    );
  }

  if (!modelPresent) {
    return (
      <div className="pron-view">
        <div className="pron-panel">
          <h3>Pronunciation model needed</h3>
          <p>
            Pronunciation analysis uses <code>wav2vec2-xlsr-53-espeak</code> (~1.2 GB), a
            multilingual phoneme model. One-time download.
          </p>
          <button className="btn primary" onClick={onDownload}>
            <Download size={16} />
            <span>Download model</span>
          </button>
          {error && <p className="pron-inline-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="pron-view">
      <div className="pron-header">
        <button className="btn primary" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? (
            <>
              <Loader2 size={15} className="spin" />
              <span>{statusLabel(status)}</span>
            </>
          ) : (
            <>
              <AudioWaveform size={15} />
              <span>{phonemes.length > 0 ? "Re-analyze" : "Analyze pronunciation"}</span>
            </>
          )}
        </button>

        {status === "done" && phonemes.length > 0 && (
          <div className="pron-score">
            <span className="pron-score-label">Overall</span>
            <span className="pron-score-value" style={{ color: scoreColor(meanConfidence) }}>
              {Math.round(meanConfidence * 100)}%
            </span>
          </div>
        )}
      </div>

      {status === "error" && error && (
        <div className="pron-panel error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {phonemes.length > 0 && (
        <>
          <p className="pron-hint">
            Each chip is a recognized sound. Color = model confidence (a proxy for clarity).
            Click any chip to jump there. Red = the model wasn't sure — your candidate gap moments.
          </p>
          <WorstPhonemes phonemes={phonemes} />
          <div className="phoneme-strip" dir="ltr">
            {phonemes.map((p, i) => {
              const active = currentTime >= p.start && currentTime < p.end;
              return (
                <button
                  key={i}
                  className={`phoneme conf-${confTier(p.confidence)} ${active ? "active" : ""}`}
                  onClick={() => onSeek(p.start)}
                  title={`${p.start.toFixed(2)}s–${p.end.toFixed(2)}s · confidence ${Math.round(
                    p.confidence * 100,
                  )}%`}
                >
                  <span className="ph-sym">{p.symbol}</span>
                  <span className="ph-conf">{Math.round(p.confidence * 100)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {analyzing && phonemes.length === 0 && (
        <div className="pron-empty">
          <Loader2 size={16} className="spin" /> <span>{statusLabel(status)}</span>
        </div>
      )}

      {status === "idle" && phonemes.length === 0 && (
        <div className="pron-empty">
          <span>Click “Analyze pronunciation” to score this recording, sound by sound.</span>
        </div>
      )}
    </div>
  );
}

function WorstPhonemes({ phonemes }: { phonemes: Phoneme[] }) {
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
    .slice(0, 5);

  if (rows.length === 0) return null;
  return (
    <div className="worst-phonemes">
      <span className="wp-label">Weakest sounds:</span>
      {rows.map((r) => (
        <span key={r.sym} className="wp-chip" title={`${r.n} occurrences`}>
          <span className="wp-sym" style={{ color: scoreColor(r.avg) }}>
            {r.sym}
          </span>
          <span className="wp-meta">
            {Math.round(r.avg * 100)}% · {r.n}×
          </span>
        </span>
      ))}
    </div>
  );
}

function confTier(c: number): "high" | "med" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
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
