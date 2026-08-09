import { describe, expect, it } from "vitest";
import { bark, durandKerner, estimateFormants, levinsonDurbin } from "./lpc";

describe("LPC math", () => {
  it("solves a small Levinson-Durbin case", () => {
    expect(levinsonDurbin([1, 0.5], 1)).toEqual([1, -0.5]);
  });

  it("finds known polynomial roots", () => {
    const roots = durandKerner([1, -6, 11, -6]).map((root) => root.re).sort((a, b) => a - b);
    expect(roots[0]).toBeCloseTo(1, 6);
    expect(roots[1]).toBeCloseTo(2, 6);
    expect(roots[2]).toBeCloseTo(3, 6);
  });

  it("matches Traunmüller Bark reference calculations", () => {
    expect(bark(1000)).toBeCloseTo(8.527, 2);
    expect(bark(500)).toBeCloseTo(4.919, 2);
  });

  it("recovers resonances from a synthetic voiced vowel", () => {
    const rate = 10000;
    const signal = new Float32Array(10000);
    for (let i = 0; i < signal.length; i += 100) signal[i] = 1;
    let filtered: Float32Array = signal;
    for (const [frequency, bandwidth] of [[500, 70], [1500, 100], [2500, 150]])
      filtered = resonator(filtered, rate, frequency, bandwidth);
    const frame = filtered.slice(7000, 8024);
    for (let i = 0; i < frame.length; i++) frame[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frame.length - 1));
    const formants = estimateFormants(frame, rate);
    expect(Math.abs(formants[0].frequency - 500) / 500).toBeLessThan(0.05);
    expect(Math.abs(formants[1].frequency - 1500) / 1500).toBeLessThan(0.05);
  });
});

function resonator(input: Float32Array, rate: number, frequency: number, bandwidth: number): Float32Array {
  const output = new Float32Array(input.length);
  const radius = Math.exp(-Math.PI * bandwidth / rate);
  const coefficient = 2 * radius * Math.cos(2 * Math.PI * frequency / rate);
  for (let i = 0; i < input.length; i++) output[i] = input[i] + coefficient * (output[i - 1] ?? 0) - radius * radius * (output[i - 2] ?? 0);
  return output;
}
