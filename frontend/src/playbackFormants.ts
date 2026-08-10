import { prepareFormantFrame, type TrackedFormants } from "./formantTracker";
import { estimateFormants } from "./lpc";

const FRAME_SECONDS = 0.025;

/** Analyze original decoded samples, never sound recaptured through the mic. */
export function analyzePlaybackFormants(buffer: AudioBuffer, time: number): TrackedFormants | null {
  const frameSize = Math.max(256, Math.round(buffer.sampleRate * FRAME_SECONDS));
  const center = Math.round(time * buffer.sampleRate);
  const start = Math.max(0, Math.min(buffer.length - frameSize, center - frameSize / 2));
  const length = Math.min(frameSize, buffer.length - start);
  if (length < 256) return null;

  const frame = new Float32Array(length);
  let power = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) frame[i] += data[start + i] / buffer.numberOfChannels;
  }
  for (const sample of frame) power += sample * sample;
  if (Math.sqrt(power / length) < 0.002) return null;

  const processed = prepareFormantFrame(frame, buffer.sampleRate);
  const candidates = estimateFormants(processed.samples, processed.sampleRate).slice(0, 3);
  if (candidates.length !== 3) return null;
  return { f1: candidates[0].frequency, f2: candidates[1].frequency, f3: candidates[2].frequency, voiced: true };
}
