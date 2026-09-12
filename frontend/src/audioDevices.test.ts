import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ api: { getAudioDevices: vi.fn() } }));
import { api } from "./api";
import { isLinuxDesktop, requireNativeCapture } from "./audioDevices";

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("Linux native capture gate", () => {
  it("recognizes the Linux desktop bridge", () => {
    vi.stubGlobal("window", { pywebview: { api: {} } });
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    expect(isLinuxDesktop()).toBe(true);
  });
  it("rechecks capabilities after each Record request, without relying on cached state", async () => {
    vi.mocked(api.getAudioDevices).mockResolvedValue({ supported: true, capture: true });
    await requireNativeCapture();
    vi.mocked(api.getAudioDevices).mockResolvedValue({ supported: false, error: "Audio service disconnected" });
    await expect(requireNativeCapture()).rejects.toThrow("Audio service disconnected");
    expect(api.getAudioDevices).toHaveBeenCalledTimes(2);
  });
  it("preserves backend restart errors instead of falling back to WebKit capture", async () => {
    vi.mocked(api.getAudioDevices).mockRejectedValue(new Error("Restart the backend"));
    await expect(requireNativeCapture()).rejects.toThrow("Restart the backend");
  });
  it("rejects native recording when ffmpeg is missing", async () => {
    vi.mocked(api.getAudioDevices).mockResolvedValue({ supported: true, capture: false });
    await expect(requireNativeCapture()).rejects.toThrow("ffmpeg");
  });
});
