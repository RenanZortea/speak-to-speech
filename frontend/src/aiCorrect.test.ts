import { expect, it } from "vitest";
import { parseAiJson } from "./aiCorrect";

const correction = { segment: 1, original: "I have 21 years old.", suggestion: "I am 21 years old.", category: "grammar", explanation: 'English uses "be" rather than "have" to state age.' };

it("repairs bare quotes in an explanation from a tutor reply", () => {
  const input = `{"corrections":[{"segment":1,"original":"I have 21 years old.","suggestion":"I am 21 years old.","category":"grammar","explanation":"English uses "be" rather than "have" to state age."}]}`;
  expect(parseAiJson(input)).toEqual({ corrections: [correction] });
});

it("preserves valid escaped quotes, backslashes, Unicode and fenced replies", () => {
  const data = { corrections: [{ ...correction, explanation: 'שלום "be" \\ path\nnext line' }] };
  expect(parseAiJson('```json\n' + JSON.stringify(data) + '\n```')).toEqual(data);
});

it("repairs multiple explanations even when explanation is not the last field", () => {
  const item = `{"explanation":"Use "be", then "have".","segment":1,"original":"have","suggestion":"am"}`;
  const result = parseAiJson(`{"corrections":[${item},${item}]}`) as { corrections: { explanation: string }[] };
  expect(result.corrections.map((c) => c.explanation)).toEqual(['Use "be", then "have".', 'Use "be", then "have".']);
});

it("does not guess repairs to original text, suggestions or missing structure", () => {
  expect(() => parseAiJson('{"corrections":[{"original":"say "hello" today"}]}')).toThrow("Invalid correction JSON");
  expect(() => parseAiJson('{"corrections":[{"segment":1 "original":"hello"}]}')).toThrow("Invalid correction JSON");
  expect(() => parseAiJson('no JSON')).toThrow("Couldn't find a JSON object");
});
