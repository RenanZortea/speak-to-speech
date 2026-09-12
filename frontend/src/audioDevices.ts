import { api, type NativeAudioDevices } from "./api";

export const AUDIO_OUTPUT_CHANGED = "audio-output-changed";
export type RecordingSource = "microphone" | "desktop" | "both";
export const microphoneDevice = () => localStorage.getItem("microphoneDevice") || "";
export const speakerDevice = () => localStorage.getItem("speakerDevice") || "";
export const nativeMicrophone = () => localStorage.getItem("nativeMicrophone") || "";
export const nativeSpeaker = () => localStorage.getItem("nativeSpeaker") || "";
export const desktopDevice = () => localStorage.getItem("desktopDevice") || "";
export const recordingSource = (): RecordingSource => {
  const source = localStorage.getItem("recordingSource");
  return source === "desktop" || source === "both" ? source : "microphone";
};
let nativeDevices: NativeAudioDevices | null = null;
export const nativeCaptureAvailable = () => !!nativeDevices?.supported && !!nativeDevices.capture;
export const isLinuxDesktop = () => typeof window !== "undefined" && !!window.pywebview
  && /Linux/i.test(navigator.platform || navigator.userAgent);

/** Recheck at Record time: HMR resets module state without restarting Python. */
export async function requireNativeCapture() {
  const devices = await refreshNativeDevices();
  if (!devices.supported || !devices.capture) {
    throw new Error(devices.error || "Native audio capture is unavailable. Check that ffmpeg, libpulse and the PulseAudio/PipeWire service are installed and running.");
  }
}
export async function refreshNativeDevices() {
  nativeDevices = await api.getAudioDevices();
  return nativeDevices;
}

/** Validate the output before persisting it; never silently save a failed selection. */
export async function selectSpeaker(device: string) {
  const probe = new Audio();
  if (!("setSinkId" in probe)) throw new Error("Output selection is unavailable in this browser.");
  await probe.setSinkId(device);
  localStorage.setItem("speakerDevice", device);
  window.dispatchEvent(new Event(AUDIO_OUTPUT_CHANGED));
}
