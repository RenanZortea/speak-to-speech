// Shared transcript-document builder. Both the CodeMirror view and the AI
// correction mapper use this so char offsets are guaranteed identical.

import type { Segment } from "./api";

export type DocWord = {
  from: number; // full span incl. leading space
  markFrom: number; // trimmed start
  to: number;
  start: number; // audio time
  end: number;
};

export type DocSegment = {
  id: number; // 1-based, matches the prompt
  from: number;
  to: number;
  text: string; // exactly the doc slice for this segment
};

export function buildTranscriptDoc(segments: Segment[]): {
  text: string;
  words: DocWord[];
  segs: DocSegment[];
} {
  let text = "";
  const words: DocWord[] = [];
  const segs: DocSegment[] = [];

  segments.forEach((seg, si) => {
    const segFrom = text.length;
    const segWords = seg.words ?? [];
    if (segWords.length > 0) {
      for (const w of segWords) {
        const from = text.length;
        const lead = w.word.length - w.word.trimStart().length;
        text += w.word;
        words.push({ from, markFrom: from + lead, to: text.length, start: w.start, end: w.end });
      }
    } else {
      text += seg.text;
    }
    const segTo = text.length;
    segs.push({ id: si + 1, from: segFrom, to: segTo, text: text.slice(segFrom, segTo) });
    if (si < segments.length - 1) text += "\n";
  });

  return { text, words, segs };
}
