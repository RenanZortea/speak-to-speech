import { expect, it, vi } from "vitest";
import type WaveSurfer from "wavesurfer.js";
import { bindPlaybackLoop } from "./playbackLoop";

function setup() {
  const listeners = new Map<string, (time: number) => void>();
  let playing = true;
  let time = 3;
  const media = Object.assign(new EventTarget(), { seeking: false });
  const ws = {
    on: (event: string, callback: (time: number) => void) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    },
    getMediaElement: () => media,
    getCurrentTime: () => time,
    isPlaying: () => playing,
    setTime: vi.fn((target: number) => {
      media.seeking = true;
      // Simulate WaveSurfer's synchronous notification while the native clock is still stale.
      listeners.get("timeupdate")?.(target);
    }),
  };
  const play = vi.fn();
  const dispose = bindPlaybackLoop(ws as unknown as WaveSurfer, { start: 2, end: 5 }, play);
  return {
    ws, play, dispose, listeners, media,
    pause: () => { playing = false; },
    tick: (next: number, reported = next) => { time = next; listeners.get("timeupdate")?.(reported); },
    settle: (next = 2) => { time = next; media.seeking = false; media.dispatchEvent(new Event("seeked")); },
  };
}

it("survives 1000 loops with delayed seeks and synchronous timeupdate re-entry", () => {
  const { ws, tick, settle } = setup();
  for (let pass = 0; pass < 1000; pass++) {
    tick(3);
    tick(5.02);
    tick(5.04);
    tick(5.06);
    expect(ws.setTime).toHaveBeenCalledTimes(pass + 1);
    settle(1.998);
    tick(1.998); // Native decoder precision must not cause another rewind.
    tick(2.1, 5.06); // A stale notification must not rewind the new pass.
    expect(ws.setTime).toHaveBeenCalledTimes(pass + 1);
  }
});

it("leaves paused playback and an existing native seek alone", () => {
  const { ws, tick, media, pause } = setup();
  media.seeking = true;
  tick(5);
  expect(ws.setTime).not.toHaveBeenCalled();
  media.seeking = false;
  pause();
  tick(5);
  expect(ws.setTime).not.toHaveBeenCalled();
});

it("restarts at the physical track end without duplicate restart requests", () => {
  const { ws, play, listeners, pause, settle } = setup();
  pause();
  listeners.get("finish")!(5);
  listeners.get("finish")!(5);
  expect(ws.setTime).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledOnce();
  settle();
  listeners.get("finish")!(5);
  expect(play).toHaveBeenCalledTimes(2);
});

it("removes playback and seek listeners when cleared or replaced", () => {
  const { dispose, listeners, media } = setup();
  const remove = vi.spyOn(media, "removeEventListener");
  dispose();
  expect(listeners.size).toBe(0);
  expect(remove).toHaveBeenCalledWith("seeked", expect.any(Function));
});
