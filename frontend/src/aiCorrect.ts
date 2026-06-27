// AI correction paste flow: generate a prompt, parse the AI's JSON reply, and
// map each correction (segment + exact quote) to a char span → Correction.

import type { Segment } from "./api";
import {
  CORRECTION_CATEGORIES,
  newCorrectionId,
  type Correction,
  type CorrectionCategory,
} from "./corrections";
import { buildTranscriptDoc } from "./transcriptDoc";

export function buildCorrectionPrompt(segments: Segment[], languageName: string): string {
  const { segs } = buildTranscriptDoc(segments);
  const input = {
    target_language: languageName,
    segments: segs.map((s) => ({ id: s.id, text: s.text.trim() })),
  };
  const cats = CORRECTION_CATEGORIES.join(" | ");

  return `You are a ${languageName} language tutor reviewing a learner's transcribed speech.
Find real errors and suggest corrections. Do NOT rewrite already-correct, fluent
text. Cover: grammar, vocabulary, word order, spelling, code-switches/gaps (where
the learner used another language), and ASR mistakes.

Rules:
- Reference each correction by the segment "id" it appears in.
- "original" MUST be an exact substring quoted from that segment's text.
- Keep "explanation" to one short sentence.
- "category" must be one of: ${cats}
- Respond with ONLY a JSON object — no prose, no markdown fences.

Input:
${JSON.stringify(input, null, 2)}

Respond with exactly this shape:
{
  "corrections": [
    {
      "segment": 1,
      "original": "<exact quote from that segment>",
      "suggestion": "<corrected text>",
      "category": "grammar",
      "explanation": "<one short sentence>"
    }
  ]
}
If there are no errors, return { "corrections": [] }.`;
}

/** Pull a JSON object out of an AI reply that may have fences or surrounding prose. */
export function parseAiJson(text: string): unknown {
  let t = text.trim();
  // strip a leading ```json / ``` fence and trailing fence
  t = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Couldn't find a JSON object in the pasted text.");
  }
  return JSON.parse(t.slice(start, end + 1));
}

export type UnplacedCorrection = { segment: number; original: string };
export type MapResult = { corrections: Correction[]; unplaced: UnplacedCorrection[] };

/** Lifecycle of an Ollama generation, owned by App so it survives the modal
 *  closing/reopening. */
export type AiGenState =
  | { status: "idle" }
  | { status: "generating"; model: string }
  | { status: "done"; output: string; result: { added: number; unplaced: UnplacedCorrection[] } }
  | { status: "error"; error: string };

export function mapAiCorrections(json: unknown, segments: Segment[]): MapResult {
  const { segs } = buildTranscriptDoc(segments);
  const byId = new Map(segs.map((s) => [s.id, s]));
  const corrections: Correction[] = [];
  const unplaced: UnplacedCorrection[] = [];

  const arr =
    json && typeof json === "object" && Array.isArray((json as any).corrections)
      ? ((json as any).corrections as any[])
      : [];

  for (const c of arr) {
    const segId = Number(c?.segment);
    const seg = byId.get(segId);
    const originalRaw = String(c?.original ?? "");
    const original = originalRaw.trim();
    const suggestion = String(c?.suggestion ?? "").trim();

    if (!seg || !original || !suggestion) {
      unplaced.push({ segment: segId, original });
      continue;
    }
    let idx = seg.text.indexOf(original);
    if (idx === -1) idx = seg.text.indexOf(originalRaw);
    if (idx === -1) {
      unplaced.push({ segment: segId, original });
      continue;
    }
    const from = seg.from + idx;
    const to = from + original.length;
    corrections.push({
      id: newCorrectionId(),
      from,
      to,
      original,
      suggestion,
      category: coerceCategory(c?.category),
      explanation: String(c?.explanation ?? "").trim(),
      source: "ai",
    });
  }

  return { corrections, unplaced };
}

function coerceCategory(c: unknown): CorrectionCategory {
  const s = String(c ?? "").toLowerCase().replace(/\s+/g, "-");
  return (CORRECTION_CATEGORIES as string[]).includes(s) ? (s as CorrectionCategory) : "grammar";
}
