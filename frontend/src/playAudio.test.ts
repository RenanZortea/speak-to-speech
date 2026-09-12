import { expect, it, vi } from "vitest";
import type WaveSurfer from "wavesurfer.js";
import { playAudio } from "./playAudio";

it("waits for a suspended audio clock to resume before playing", async () => {
  let finishResume!: () => void;
  const resume = vi.fn(() => new Promise<void>((resolve) => { finishResume = resolve; }));
  const play = vi.fn(async () => {});
  const ws = { getMediaElement: () => ({ getGainNode: () => ({ context: { state: "suspended", resume } }) }), play } as unknown as WaveSurfer;
  const result = playAudio(ws);
  expect(resume).toHaveBeenCalledOnce();
  expect(play).not.toHaveBeenCalled();
  finishResume();
  await result;
  expect(play).toHaveBeenCalledOnce();
});

it("propagates resume failures without starting a frozen player", async () => {
  const play = vi.fn();
  const ws = { getMediaElement: () => ({ getGainNode: () => ({ context: {
    state: "suspended", resume: async () => { throw new Error("Audio unavailable"); },
  } }) }), play } as unknown as WaveSurfer;
  await expect(playAudio(ws)).rejects.toThrow("Audio unavailable");
  expect(play).not.toHaveBeenCalled();
});
