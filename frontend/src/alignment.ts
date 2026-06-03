// Pairs wav2vec2 phonemes with Whisper words by timestamp overlap, and derives
// a 2D confidence read per word:
//
//   lexical confidence  (Whisper word probability) — "am I sure of the word?"
//   acoustic confidence (avg phoneme confidence)   — "were the sounds clear?"
//
//   lex hi + aco hi → clear       (well said)
//   lex hi + aco lo → accent      (right word, off pronunciation)  ← the target
//   lex lo + aco hi → codeswitch  (clear sounds, unsure word)
//   lex lo + aco lo → gap         (garbled / a real gap)
//
// Phonemes that overlap no word (in silences/gaps) stay "floating" — deliberately
// NOT snapped to a word, so per-word groups stay accurate.

import type { Phoneme, Segment, Word } from "./api";

export type Category = "clear" | "accent" | "codeswitch" | "gap" | "unknown";

export type AlignedWord = {
  word: string;
  start: number;
  end: number;
  lexicalConf: number;
  acousticConf: number | null; // null when no phonemes overlap this word
  phonemes: Phoneme[];
  category: Category;
};

export type Alignment = {
  words: AlignedWord[];
  floating: Phoneme[];
};

// Tunable thresholds — Whisper word probs run high; wav2vec2 conf is more spread.
// Revisit against real data.
const LEX_HI = 0.75;
const ACO_HI = 0.6;

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function categorize(lex: number, aco: number | null): Category {
  if (aco === null) return "unknown";
  const lexHi = lex >= LEX_HI;
  const acoHi = aco >= ACO_HI;
  if (lexHi && acoHi) return "clear";
  if (lexHi && !acoHi) return "accent";
  if (!lexHi && acoHi) return "codeswitch";
  return "gap";
}

export function flattenWords(segments: Segment[]): Word[] {
  const words: Word[] = [];
  for (const seg of segments) {
    for (const w of seg.words ?? []) {
      words.push({ ...w, word: w.word.trim() });
    }
  }
  return words;
}

export function alignPhonemes(segments: Segment[], phonemes: Phoneme[]): Alignment {
  const words = flattenWords(segments);

  // No word timestamps (older session) → everything floats; nothing to group.
  if (words.length === 0) {
    return { words: [], floating: [...phonemes] };
  }

  const buckets: Phoneme[][] = words.map(() => []);
  const floating: Phoneme[] = [];

  for (const ph of phonemes) {
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < words.length; i++) {
      const ov = overlap(ph.start, ph.end, words[i].start, words[i].end);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestOverlap > 0) buckets[bestIdx].push(ph);
    else floating.push(ph); // overlaps no word → in a gap → floating
  }

  const aligned: AlignedWord[] = words.map((w, i) => {
    const phs = buckets[i];
    const acousticConf =
      phs.length > 0 ? phs.reduce((s, p) => s + p.confidence, 0) / phs.length : null;
    return {
      word: w.word,
      start: w.start,
      end: w.end,
      lexicalConf: w.probability,
      acousticConf,
      phonemes: phs,
      category: categorize(w.probability, acousticConf),
    };
  });

  return { words: aligned, floating };
}

export const CATEGORY_LABELS: Record<Category, string> = {
  clear: "Clear",
  accent: "Off pronunciation",
  codeswitch: "Unclear word",
  gap: "Possible gap",
  unknown: "No sound data",
};

export const CATEGORY_HINTS: Record<Category, string> = {
  clear: "Right word, clear sounds.",
  accent: "The word is right but the pronunciation drifted — your main practice target.",
  codeswitch: "Sounds were clear, but the model wasn't sure of the word — possible code-switch or rare word.",
  gap: "Both unsure — garbled or a genuine gap moment.",
  unknown: "No phonemes aligned to this word.",
};

export function categoryColor(c: Category): string {
  switch (c) {
    case "clear": return "#5ec47b";
    case "accent": return "#e4b85e";
    case "codeswitch": return "#8a7ff0";
    case "gap": return "#e2554a";
    case "unknown": return "#6b7280";
  }
}
