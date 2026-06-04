// Manual correction layer. The base transcript is immutable; every change is a
// correction anchored to a stable char span [from,to] in the base document.
// (AI-sourced corrections will later produce the same shape.)

export type CorrectionCategory =
  | "grammar"
  | "vocabulary"
  | "word-order"
  | "spelling"
  | "gap"
  | "style"
  | "asr-error";

export type Correction = {
  id: string;
  from: number;
  to: number;
  original: string;
  suggestion: string;
  category: CorrectionCategory;
  explanation: string;
  source: "manual" | "ai";
};

export const CORRECTION_CATEGORIES: CorrectionCategory[] = [
  "grammar",
  "vocabulary",
  "word-order",
  "spelling",
  "gap",
  "style",
  "asr-error",
];

export const CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  "word-order": "Word order",
  spelling: "Spelling",
  gap: "Gap / code-switch",
  style: "Style",
  "asr-error": "Misheard (ASR)",
};

export const CATEGORY_COLOR: Record<CorrectionCategory, string> = {
  grammar: "#6ea8ff",
  vocabulary: "#5ec47b",
  "word-order": "#e4b85e",
  spelling: "#b48eff",
  gap: "#e2554a",
  style: "#9aa0ad",
  "asr-error": "#e09b5a",
};

export function newCorrectionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Apply accepted corrections to the base text → the "corrected version".
 *  Processes right-to-left so earlier offsets stay valid. */
export function applyCorrections(base: string, corrections: Correction[]): string {
  const sorted = [...corrections].sort((a, b) => b.from - a.from);
  let out = base;
  for (const c of sorted) {
    if (c.suggestion) out = out.slice(0, c.from) + c.suggestion + out.slice(c.to);
  }
  return out;
}
