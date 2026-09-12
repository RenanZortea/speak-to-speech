import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, FileText, Info, Pencil, Play, X } from "lucide-react";
import type { Segment } from "./api";
import { CATEGORY_COLOR, CATEGORY_LABEL, correctedSentenceAt, type Correction } from "./corrections";
import { buildTranscriptDoc } from "./transcriptDoc";
import type { CorrectionView } from "./CodeTranscript";
import type { MenuTarget } from "./CorrectionMenu";

export function activeLyric(segments: Segment[], time: number): number {
  return segments.findIndex((segment) => time >= segment.start && time < segment.end);
}

// Keep source offsets and timing even when a replacement has a different word count.
export function buildLyricLines(segments: Segment[], corrections: Correction[], view: CorrectionView) {
  const doc = buildTranscriptDoc(segments);
  let lastTo = -1;
  const valid = [...corrections].sort((a, b) => a.from - b.from).filter((c) => {
    if (c.from < 0 || c.from < lastTo || c.to <= c.from || c.to > doc.text.length) return false;
    lastTo = c.to;
    return true;
  });
  const lines = doc.segs.map((seg, index) => {
    const words = doc.words.filter((w) => w.from < seg.to && w.to > seg.from);
    const boundaries = new Set([seg.from, seg.to]);
    words.forEach((w) => { boundaries.add(w.from); boundaries.add(w.to); });
    valid.forEach((c) => {
      if (c.from < seg.to && c.to > seg.from) {
        boundaries.add(Math.max(seg.from, c.from));
        boundaries.add(Math.min(seg.to, c.to));
      }
    });
    const points = [...boundaries].sort((a, b) => a - b);
    return points.slice(0, -1).flatMap((from, i) => {
      const to = points[i + 1];
      const word = words.find((w) => from >= w.from && from < w.to);
      const replacement = valid.find((c) => from >= c.from && from < c.to);
      const correction = replacement ?? valid.find((c) => word && c.from < word.to && c.to > word.markFrom);
      if (view === "corrected" && replacement && from !== replacement.from) return [];
      const covered = replacement ? doc.words.filter((w) => w.from < replacement.to && w.to > replacement.from) : [];
      return [{
        from,
        text: view === "corrected" && replacement ? replacement.suggestion || "∅" : doc.text.slice(from, to),
        start: covered[0]?.start ?? word?.start ?? segments[index].start,
        end: covered[covered.length - 1]?.end ?? word?.end ?? segments[index].end,
        correction,
      }];
    });
  });
  return { ...doc, lines, corrections: valid };
}

export function LyricsTranscript({ segments, currentTime, onSeek, corrections = [], view = "original", onRequestContextMenu }: {
  segments: Segment[]; currentTime: number; onSeek: (time: number) => void;
  corrections?: Correction[]; view?: CorrectionView; onRequestContextMenu?: (target: MenuTarget) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const doc = useMemo(() => buildLyricLines(segments, corrections, view), [segments, corrections, view]);
  const active = activeLyric(segments, currentTime);
  useEffect(() => { setSelectedId(null); setCopyStatus(""); }, [segments, corrections, view]);
  useEffect(() => {
    const container = host.current;
    const line = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !line) return;
    container.scrollTo({
      top: line.offsetTop - container.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [active]);
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopyStatus(`${label} copied`); }
    catch { setCopyStatus("Could not copy. Please try again."); }
  }
  return <div ref={host} className="lyrics" aria-label="Synchronized transcript" onKeyDown={(event) => {
    if (event.key === "Escape") { setSelectedId(null); host.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); }
  }}>
    {doc.lines.map((parts, index) => {
      const selected = parts.find((part) => part.correction?.id === selectedId)?.correction;
      const selectedPart = parts.find((part) => part.correction?.id === selectedId);
      return <div key={index} dir="auto" className="lyric-line" aria-current={index === active}>
        {parts.map((part, partIndex) => {
          const c = part.correction;
          const showInfo = c && !parts.slice(partIndex + 1).some((next) => next.correction?.id === c.id);
          return <span key={part.from} className={c ? "lyric-correction" : undefined}
            style={c ? { "--correction-color": CATEGORY_COLOR[c.category] } as CSSProperties : undefined}>
            <button type="button"
              className={`lyric-word${currentTime >= part.start && currentTime < part.end ? " current" : ""}`}
              data-start={part.start} data-end={part.end}
              title={`Play from ${part.start.toFixed(2)}s${c ? ` · ${CATEGORY_LABEL[c.category]}: ${c.original} → ${c.suggestion}` : ""}`}
              aria-label={`${part.text.trim()} — play from ${part.start.toFixed(2)} seconds`}
              onClick={() => onSeek(part.start)}>{part.text}</button>
            {showInfo && <button type="button" className="lyric-info" title={`${CATEGORY_LABEL[c.category]} correction`}
              aria-label={`Correction details: ${c.original}`} aria-expanded={selectedId === c.id}
              aria-controls={`lyric-detail-${index}`}
              onClick={() => { setSelectedId(selectedId === c.id ? null : c.id); setCopyStatus(""); }}><Info size={14} /></button>}
          </span>;
        })}
        {selected && selectedPart && <div className="lyric-detail" id={`lyric-detail-${index}`} dir="ltr" role="region" aria-label="Correction details">
          <div className="lyric-detail-heading"><span style={{ color: CATEGORY_COLOR[selected.category] }}>{CATEGORY_LABEL[selected.category]}</span>
            <button type="button" title="Close details" aria-label="Close correction details" onClick={() => {
              host.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); setSelectedId(null);
            }}><X size={16} /></button></div>
          <div className="lyric-detail-comparison"><span>You said</span><s dir="auto">{selected.original}</s><span>Correction</span><strong dir="auto">{selected.suggestion || "Remove this text"}</strong></div>
          {selected.explanation && <p>{selected.explanation}</p>}
          <div className="lyric-detail-actions">
            <button type="button" title="Play original audio" aria-label="Play original audio" onClick={() => onSeek(selectedPart.start)}><Play size={16} /></button>
            <button type="button" title="Copy corrected word or phrase" aria-label="Copy corrected word or phrase" disabled={!selected.suggestion} onClick={() => void copy(selected.suggestion, "Correction")}><Copy size={16} /></button>
            <button type="button" title="Copy corrected sentence" aria-label="Copy corrected sentence" onClick={() => void copy(correctedSentenceAt(doc.text, doc.corrections, selected.from, selected.to), "Sentence")}><FileText size={16} /></button>
            {onRequestContextMenu && <button type="button" title="Edit correction options" aria-label="Edit correction options" onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onRequestContextMenu({ x: rect.left, y: rect.bottom, from: selected.from, to: selected.to, original: selected.original, existingId: selected.id, time: selectedPart.start });
            }}><Pencil size={16} /></button>}
            <span role="status">{copyStatus.endsWith("copied") && <Check size={14} />}{copyStatus}</span>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}
