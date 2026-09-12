import { expect, it } from "vitest";
import { buildTranscriptDoc, transcriptWordAt } from "./transcriptDoc";

it("seeks the next word at a shared boundary and its leading whitespace", () => {
  const { words } = buildTranscriptDoc([{ start: 0, end: 5, avg_logprob: 0, no_speech_prob: 0, text: "one two", words: [
    { word: "one", start: 1, end: 2, probability: 1 }, { word: " two", start: 3, end: 4, probability: 1 },
  ] }]);
  expect(transcriptWordAt(words, 2)?.start).toBe(1);
  expect(transcriptWordAt(words, 3)?.start).toBe(3);
  expect(transcriptWordAt(words, 4)?.start).toBe(3);
  expect(transcriptWordAt(words, 7)).toBeUndefined();
});
