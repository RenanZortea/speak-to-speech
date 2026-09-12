import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ api: {} }));
import { captureAudio } from "./captureAudio";

function track(kind: string) { return { kind, stop: vi.fn(), addEventListener: vi.fn() }; }
function stream(tracks: ReturnType<typeof track>[]) {
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === "audio") } as unknown as MediaStream;
}
afterEach(() => vi.unstubAllGlobals());

describe("audio source capture", () => {
  it("never opens WebKit screen sharing in the Linux desktop app", async () => {
    const getDisplayMedia = vi.fn();
    vi.stubGlobal("window", { pywebview: { api: {} } });
    vi.stubGlobal("navigator", { platform: "Linux x86_64", mediaDevices: { getDisplayMedia } });
    await expect(captureAudio("both", "")).rejects.toThrow("requires native capture");
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("rejects screen sharing without audio and releases its video track", async () => {
    const video = track("video");
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream([video])) } });
    await expect(captureAudio("desktop", "")).rejects.toThrow("No desktop audio was shared");
    expect(video.stop).toHaveBeenCalledOnce();
  });

  it("releases desktop capture when microphone permission fails", async () => {
    const audio = track("audio"), video = track("video");
    vi.stubGlobal("navigator", { mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(stream([audio, video])),
      getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
    } });
    await expect(captureAudio("both", "mic-id")).rejects.toThrow("Permission denied");
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalledOnce();
  });

  it("mixes desktop and microphone without connecting to speakers and cleans up", async () => {
    const desktop = track("audio"), video = track("video"), mic = track("audio"), mixed = track("audio");
    const close = vi.fn().mockResolvedValue(undefined);
    const destination = { stream: stream([mixed]) };
    const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = [];
    const connect = vi.fn((gain) => gain);
    vi.stubGlobal("AudioContext", class {
      close = close;
      resume = vi.fn().mockResolvedValue(undefined);
      createMediaStreamDestination = () => destination;
      createMediaStreamSource = () => ({ connect });
      createGain = () => { const gain = { gain: { value: 1 }, connect: vi.fn() }; gains.push(gain); return gain; };
    });
    const getUserMedia = vi.fn().mockResolvedValue(stream([mic]));
    vi.stubGlobal("navigator", { mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(stream([desktop, video])), getUserMedia,
    } });
    const result = await captureAudio("both", "chosen-mic");
    expect(result.stream).toBe(destination.stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "chosen-mic" }, echoCancellation: true, autoGainControl: false } });
    expect(gains).toHaveLength(2);
    expect(gains.map((gain) => gain.gain.value)).toEqual([0.5, 1]);
    gains.forEach((gain) => expect(gain.connect).toHaveBeenCalledWith(destination));
    const stop = vi.fn(); result.onEnded(stop);
    expect(video.addEventListener).toHaveBeenCalledWith("ended", stop, { once: true });
    result.close(); result.close();
    [desktop, video, mic, mixed].forEach((t) => expect(t.stop).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
  });
});
