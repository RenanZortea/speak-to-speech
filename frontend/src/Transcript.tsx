import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Phoneme, Segment } from "./api";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  categoryColor,
  type AlignedWord,
  type Alignment,
} from "./alignment";

interface Props {
  segments: Segment[];
  alignment: Alignment | null; // present once pronunciation has been analyzed
  currentTime: number;
  onSeek: (t: number) => void;
}

export function Transcript({ segments, alignment, currentTime, onSeek }: Props) {
  const activeSegIdx = segments.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end,
  );
  const activeRef = useRef<HTMLDivElement>(null);
  const [openWordIdx, setOpenWordIdx] = useState<number | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegIdx]);

  if (segments.length === 0) {
    return (
      <div className="transcript empty">
        <span>No transcript yet — pick a file or record, then transcribe.</span>
      </div>
    );
  }

  const pron = alignment;
  // Running index into the flat aligned-words list, advanced as we render.
  let wordCursor = 0;

  return (
    <div className="transcript">
      {pron && openWordIdx !== null && (
        <div className="word-popover-backdrop" onClick={() => setOpenWordIdx(null)} />
      )}

      {segments.map((s, i) => {
        const isActive = i === activeSegIdx;
        const words = s.words ?? [];
        const usePron = pron !== null && words.length > 0;

        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            className={`segment ${isActive ? "active" : ""} ${
              usePron ? "pron" : `conf-${confidenceTier(s.avg_logprob)}`
            }`}
          >
            <div className="seg-meta" onClick={() => onSeek(s.start)}>
              <span className="seg-time">{fmtTime(s.start)}</span>
              {isActive && <ChevronRight size={12} className="seg-active-arrow" />}
            </div>

            {usePron ? (
              <div className="seg-text pron-text" dir="rtl">
                {words.map((w, wi) => {
                  const idx = wordCursor++;
                  const aw = pron!.words[idx];
                  const wordActive = currentTime >= w.start && currentTime < w.end;
                  return (
                    <Word
                      key={wi}
                      aw={aw}
                      text={w.word}
                      active={wordActive}
                      open={openWordIdx === idx}
                      onClick={() => {
                        onSeek(w.start);
                        setOpenWordIdx((cur) => (cur === idx ? null : idx));
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="seg-text" dir="rtl" onClick={() => onSeek(s.start)}>
                {s.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Word({
  aw,
  text,
  active,
  open,
  onClick,
}: {
  aw: AlignedWord | undefined;
  text: string;
  active: boolean;
  open: boolean;
  onClick: () => void;
}) {
  const color = aw ? categoryColor(aw.category) : "transparent";
  return (
    <span className="word-wrap">
      <span
        className={`word ${active ? "active" : ""}`}
        style={{ borderBottomColor: color }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {text}
      </span>
      {open && aw && <WordPopover aw={aw} />}
    </span>
  );
}

function WordPopover({ aw }: { aw: AlignedWord }) {
  return (
    <div className="word-popover" dir="ltr" onClick={(e) => e.stopPropagation()}>
      <div className="wp-head">
        <span className="wp-cat" style={{ color: categoryColor(aw.category) }}>
          {CATEGORY_LABELS[aw.category]}
        </span>
        <span className="wp-confs">
          word {Math.round(aw.lexicalConf * 100)}%
          {aw.acousticConf !== null && <> · sound {Math.round(aw.acousticConf * 100)}%</>}
        </span>
      </div>
      <p className="wp-hint">{CATEGORY_HINTS[aw.category]}</p>
      {aw.phonemes.length > 0 ? (
        <div className="wp-phonemes">
          {aw.phonemes.map((p, i) => (
            <PhonemeChip key={i} p={p} />
          ))}
        </div>
      ) : (
        <p className="wp-empty">No aligned phonemes.</p>
      )}
    </div>
  );
}

function PhonemeChip({ p }: { p: Phoneme }) {
  return (
    <span
      className={`wp-ph conf-${phonTier(p.confidence)}`}
      title={`${p.start.toFixed(2)}s · ${Math.round(p.confidence * 100)}%`}
    >
      <span className="wp-ph-sym">{p.symbol}</span>
      <span className="wp-ph-conf">{Math.round(p.confidence * 100)}</span>
    </span>
  );
}

function confidenceTier(avgLogprob: number): "high" | "med" | "low" {
  if (avgLogprob >= -0.3) return "high";
  if (avgLogprob >= -0.6) return "med";
  return "low";
}

function phonTier(c: number): "high" | "med" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}
