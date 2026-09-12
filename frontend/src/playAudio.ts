import type WaveSurfer from "wavesurfer.js";

/** Resume the Web Audio clock from the user's playback gesture before starting. */
export async function playAudio(ws: WaveSurfer): Promise<void> {
  const media = ws.getMediaElement() as unknown as { getGainNode?: () => GainNode };
  const context = media.getGainNode?.().context as AudioContext | undefined;
  if (context?.state === "suspended") await context.resume();
  await ws.play();
}
