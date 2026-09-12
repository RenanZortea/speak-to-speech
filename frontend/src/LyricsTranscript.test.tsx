import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { activeLyric, buildLyricLines, LyricsTranscript } from "./LyricsTranscript";
import type { Segment } from "./api";
import type { Correction } from "./corrections";

const segments: Segment[] = [
  { start: 1, end: 2, text: "First", avg_logprob: 0, no_speech_prob: 0 },
  { start: 3, end: 4, text: "שלום", avg_logprob: 0, no_speech_prob: 0 },
];

it("handles segment boundaries, silence and seeking backward", () => {
  expect([0, 1, 2, 3, 4, 1.5].map((time) => activeLyric(segments, time)))
    .toEqual([-1, 0, -1, 1, -1, 0]);
});

it("renders untimed text with automatic direction and marks the current lyric", () => {
  const html = renderToStaticMarkup(<LyricsTranscript segments={segments} currentTime={3.5} onSeek={() => {}} />);
  expect(html).toContain('dir="auto"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("שלום");
  expect(html).toContain("First");
});


it("gives each timed word its own accessible seek control and exact timestamps", () => {
  const html = renderToStaticMarkup(<LyricsTranscript segments={[{
    ...segments[0], words: [
      { word: "One", start: 1.1, end: 1.4, probability: 1 },
      { word: " two", start: 1.5, end: 1.9, probability: 1 },
    ],
  }]} currentTime={1.6} onSeek={() => {}} />);
  expect(html).toContain('data-start="1.1" data-end="1.4"');
  expect(html).toContain('class="lyric-word current" data-start="1.5"');
  expect(html).toContain("two — play from 1.50 seconds");
  expect(html.match(/<button /g)).toHaveLength(2);
});

const timed: Segment[] = [{ ...segments[0], text: "I goed home.", words: [
  { word: "I", start: 1, end: 1.2, probability: 1 },
  { word: " goed", start: 1.2, end: 1.5, probability: 1 },
  { word: " home.", start: 1.5, end: 2, probability: 1 },
] }];
const correction: Correction = { id: "test", from: 2, to: 6, original: "goed", suggestion: "went back", category: "grammar", explanation: "Use the past tense.", source: "manual" };


it("replaces a correction once while preserving surrounding text and source audio timing", () => {
  const { lines } = buildLyricLines(timed, [correction], "corrected");
  expect(lines[0].map((p) => p.text).join("")).toBe("I went back home.");
  expect(lines[0].find((p) => p.text === "went back")).toMatchObject({ start: 1.2, end: 1.5 });
  expect(lines[0].find((p) => p.text === " home.")).toMatchObject({ start: 1.5, end: 2 });
});

it("retains original text, category colors and accessible correction controls during playback", () => {
  const { lines } = buildLyricLines(timed, [correction], "original");
  expect(lines[0].map((p) => p.text).join("")).toBe("I goed home.");
  const html = renderToStaticMarkup(<LyricsTranscript segments={timed} corrections={[correction]} view="corrected" currentTime={1.3} onSeek={() => {}} />);
  expect(html).toContain("--correction-color:#6ea8ff");
  expect(html).toContain('aria-label="Correction details: goed"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('went back');
});

it("maps multiword corrections to their full original timing and drops invalid or overlapping spans", () => {
  const phrase = { ...correction, to: 11, original: "goed home", suggestion: "returned" };
  const { lines } = buildLyricLines(timed, [phrase, { ...correction, id: "overlap" }, { ...correction, from: -1 }], "corrected");
  expect(lines[0].map((p) => p.text).join("")).toBe("I returned.");
  expect(lines[0].find((p) => p.text === "returned")).toMatchObject({ start: 1.2, end: 2 });
});

it("supports corrections without word timestamps and RTL text", () => {
  const c = { ...correction, from: 6, to: 10, original: "שלום", suggestion: "היי" };
  const { lines } = buildLyricLines(segments, [c], "corrected");
  expect(lines[1]).toEqual([expect.objectContaining({ text: "היי", start: 3, end: 4 })]);
});
