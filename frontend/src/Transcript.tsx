import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { Segment } from "./api";

interface Props {
  segments: Segment[];
  currentTime: number;
  onSeek: (t: number) => void;
}

export function Transcript({ segments, currentTime, onSeek }: Props) {
  const activeIdx = segments.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end,
  );
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  if (segments.length === 0) {
    return (
      <div className="transcript empty">
        <span>No transcript yet — pick a file or record, then transcribe.</span>
      </div>
    );
  }

  return (
    <div className="transcript">
      {segments.map((s, i) => {
        const tier = confidenceTier(s.avg_logprob);
        const isActive = i === activeIdx;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            className={`segment conf-${tier} ${isActive ? "active" : ""}`}
            onClick={() => onSeek(s.start)}
          >
            <div className="seg-meta">
              <span className="seg-time">{fmtTime(s.start)}</span>
              <span
                className={`seg-conf-dot conf-${tier}`}
                title={`avg_logprob: ${s.avg_logprob.toFixed(2)}\nno_speech_prob: ${s.no_speech_prob.toFixed(2)}`}
              />
              {isActive && <ChevronRight size={12} className="seg-active-arrow" />}
            </div>
            <div className="seg-text" dir="rtl">
              {s.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * faster-whisper avg_logprob is roughly in (-1.0 .. 0). Closer to 0 = more confident.
 * Empirically, < -0.5 is where the model gets uncertain. < -1.0 is very iffy.
 */
function confidenceTier(avgLogprob: number): "high" | "med" | "low" {
  if (avgLogprob >= -0.3) return "high";
  if (avgLogprob >= -0.6) return "med";
  return "low";
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}
