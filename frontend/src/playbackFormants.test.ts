import { describe, expect, it } from "vitest";
import { analyzePlaybackFormants } from "./playbackFormants";

describe("recorded-audio formant analysis", () => {
  it("recovers a high-front vowel from a decoded audio buffer", () => {
    const rate = 10000;
    const excitation = new Float32Array(10000);
    for (let i = 0; i < excitation.length; i += 83) excitation[i] = 1;
    let audio: Float32Array = excitation;
    for (const [frequency, bandwidth] of [[300, 60], [2670, 100], [3320, 150]])
      audio = resonator(audio, rate, frequency, bandwidth);
    const result = analyzePlaybackFormants(mockBuffer(audio, rate), 0.75);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.f2 - 2670) / 2670).toBeLessThan(0.05);
    expect(Math.abs(result!.f3 - 3320) / 3320).toBeLessThan(0.05);
  });

  it("does not invent formants during silence", () => {
    expect(analyzePlaybackFormants(mockBuffer(new Float32Array(10000), 10000), 0.5)).toBeNull();
  });
});

function mockBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

function resonator(input: Float32Array, rate: number, frequency: number, bandwidth: number): Float32Array {
  const output = new Float32Array(input.length);
  const radius = Math.exp(-Math.PI * bandwidth / rate);
  const coefficient = 2 * radius * Math.cos(2 * Math.PI * frequency / rate);
  for (let i = 0; i < input.length; i++) output[i] = input[i] + coefficient * (output[i - 1] ?? 0) - radius * radius * (output[i - 2] ?? 0);
  return output;
}
