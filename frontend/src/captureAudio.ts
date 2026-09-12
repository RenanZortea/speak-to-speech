import { isLinuxDesktop, type RecordingSource } from "./audioDevices";

export type AudioCapture = { stream: MediaStream; close: () => void; onEnded: (callback: () => void) => void };

/** Own every acquired track, including the display's video track, until capture ends. */
export async function captureAudio(mode: RecordingSource, deviceId: string): Promise<AudioCapture> {
  const streams: MediaStream[] = [];
  let context: AudioContext | undefined;
  let output: MediaStream | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const tracks = new Set([...streams, ...(output ? [output] : [])].flatMap((stream) => stream.getTracks()));
    tracks.forEach((track) => track.stop());
    void context?.close().catch(() => {});
  };
  try {
    if (mode !== "microphone") {
      if (isLinuxDesktop()) throw new Error("Desktop audio in the Linux app requires native capture. Restart the app and check its audio settings.");
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Desktop capture is unavailable here. On Linux, use the desktop app with ffmpeg and libpulse installed.");
      // Must be the first permission request while the Record click is active.
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: "include" } as DisplayMediaStreamOptions);
      streams.push(display);
      if (!display.getAudioTracks().length) throw new Error("No desktop audio was shared. Choose a screen or tab with audio sharing enabled, then record again.");
    }
    if (mode !== "desktop") {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        autoGainControl: false,
      } }));
    }
    if (mode === "both") {
      context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      for (const [index, stream] of streams.entries()) {
        const gain = context.createGain();
        // Desktop is first; preserve the microphone level for shadowing.
        gain.gain.value = index === 0 ? 0.5 : 1;
        context.createMediaStreamSource(stream).connect(gain).connect(destination);
      }
      await context.resume();
      output = destination.stream;
    } else {
      output = new MediaStream(streams[0].getAudioTracks());
    }
    return { stream: output, close, onEnded: (callback) => {
      for (const stream of streams) stream.getTracks().forEach((track) => track.addEventListener("ended", callback, { once: true }));
    } };
  } catch (error) {
    close();
    throw error;
  }
}
