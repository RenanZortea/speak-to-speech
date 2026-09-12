import type WaveSurfer from "wavesurfer.js";

export interface PlaybackLoop { start: number; end: number }

/** Let each native media seek settle before accepting another loop boundary. */
export function bindPlaybackLoop(ws: WaveSurfer, loop: PlaybackLoop, play: () => void): () => void {
  if (!Number.isFinite(loop.start) || !Number.isFinite(loop.end) || loop.start < 0 || loop.end <= loop.start) {
    return () => {};
  }
  const media = ws.getMediaElement();
  let rewinding = false;
  const onSeeked = () => { rewinding = false; };
  media.addEventListener("seeked", onSeeked);

  const rewind = () => {
    if (rewinding || media.seeking) return false;
    // setTime emits timeupdate synchronously; latch before calling it.
    rewinding = true;
    try {
      ws.setTime(loop.start);
    } finally {
      // A no-op seek need not emit seeked.
      if (!media.seeking) rewinding = false;
    }
    return true;
  };
  const offTime = ws.on("timeupdate", () => {
    // Read the live clock: queued notifications can describe the previous pass.
    // A decoder may land just before start; let it play through instead of seeking again.
    if (ws.isPlaying() && ws.getCurrentTime() >= loop.end) rewind();
  });
  const offFinish = ws.on("finish", () => {
    if (rewind()) play();
  });
  return () => {
    offTime();
    offFinish();
    media.removeEventListener("seeked", onSeeked);
  };
}
