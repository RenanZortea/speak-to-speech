import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Recorder, type RecordingController } from "./Recorder";
import { WorkspaceToolbar } from "./Sidebar";
import { AudioBar } from "./AudioBar";

vi.mock("./api", () => ({ api: {} }));

const noop = () => {};
const recorder: RecordingController = {
  state: { kind: "idle" }, elapsed: 0, stream: null,
  start: async () => true, stop: noop, cancel: noop, togglePause: async () => {}, dismissError: noop, canStart: true,
};

describe("recording workspace progression", () => {
  it("offers one prominent recording action before recording starts", () => {
    const html = renderToStaticMarkup(<Recorder controller={recorder} prominent />);
    expect(html).toContain('aria-label="Start recording"');
    expect(html).not.toContain("Discard recording");
    expect(html).not.toContain("Live microphone waveform");
  });

  it("shows stop, elapsed time, discard and the live waveform during recording", () => {
    const html = renderToStaticMarkup(<Recorder prominent controller={{
      ...recorder, stream: {} as MediaStream, state: { kind: "recording", startedAt: 0 }, elapsed: 65,
    }} />);
    expect(html).toContain('aria-label="Stop recording"');
    expect(html).toContain("1:05");
    expect(html).toContain("Discard recording");
    expect(html).toContain("Live microphone waveform");
  });

  it("shows recording status without a browser stream for native capture", () => {
    const html = renderToStaticMarkup(<Recorder prominent controller={{
      ...recorder, state: { kind: "recording", startedAt: 0 }, elapsed: 5,
    }} />);
    expect(html).toContain("Recording · preview unavailable");
    expect(html).toContain("Stop recording");
    expect(html).not.toContain("Live microphone waveform");
  });

  it("does not offer export or corrections until a transcript exists", () => {
    const props = {
      audioPath: "/recording.webm", busy: false, temperature: 0, corrections: [],
      models: [], languages: [], activeModelId: "", activeLanguage: "auto",
      detectedLanguage: null, onTemperatureChange: noop, onLanguageChange: noop,
      onModelChange: noop, onOpenModelManager: noop, onOpenAiCorrect: noop,
    };
    const empty = renderToStaticMarkup(<WorkspaceToolbar {...props} segments={[]} />);
    expect(empty).not.toContain("Export</summary>");
    expect(empty).not.toContain("Correct with AI");
    const ready = renderToStaticMarkup(<WorkspaceToolbar {...props} segments={[
      { start: 0, end: 1, text: "Hello", words: [], avg_logprob: -0.1, no_speech_prob: 0 },
    ]} />);
    expect(ready).toContain("Export</summary>");
    expect(ready).toContain("Correct with AI");
  });

  it("provides an accessible trash action and disables it while work is pending", () => {
    const props = {
      url: "/audio?v=main", sourceKey: 1, segments: [], currentTime: 0,
      onTimeChange: noop, registerSeek: noop, hasCorrections: false,
      correctionView: "corrected" as const, onCorrectionViewChange: noop,
      onPlayingChange: noop, onPlaybackFormants: noop, analyzePlayback: false,
      onClear: noop,
    };
    const html = renderToStaticMarkup(<AudioBar {...props} />);
    expect(html).toContain('aria-label="Clear recording"');
    expect(html).toContain("lucide-trash-2");
    const pending = renderToStaticMarkup(<AudioBar {...props} clearDisabled />);
    expect(pending).toMatch(/aria-label="Clear recording"[^>]*disabled=""/);
  });

  it("does not render playback controls without audio", () => {
    const html = renderToStaticMarkup(<AudioBar url={null} sourceKey={0} segments={[]}
      currentTime={0} onTimeChange={noop} registerSeek={noop} hasCorrections={false}
      correctionView="corrected" onCorrectionViewChange={noop} onPlayingChange={noop}
      onPlaybackFormants={noop} analyzePlayback={false} />);
    expect(html).not.toContain("Playback speed");
    expect(html).not.toContain("<button");
  });
});

it("offers resume and stop while recording is paused in both layouts", () => {
  for (const prominent of [true, false]) {
    const html = renderToStaticMarkup(<Recorder controller={{
      ...recorder, state: { kind: "paused", durationMs: 65000 }, elapsed: 65,
    }} prominent={prominent} />);
    expect(html).toContain('aria-label="Resume recording"');
    expect(html).toContain("Stop");
    expect(html).toContain("1:05");
    expect(html).not.toContain('class="rec-pulse"');
  }
});
