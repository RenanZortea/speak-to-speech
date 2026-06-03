import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import type { Segment } from "./api";

interface Props {
  url: string | null;
  segments: Segment[];
  playbackRate: number;
  volume: number;
  onReady: (ws: WaveSurfer, duration: number) => void;
  onTime: (t: number) => void;
  onPlayStateChange: (playing: boolean) => void;
}

/**
 * Wavesurfer.js-based waveform. Owns playback (replaces the bare <audio> element).
 * Exposes its WaveSurfer instance via onReady so the parent can drive play/pause/seek.
 *
 * Segment boundaries are rendered as thin vertical ticks on an absolutely-positioned
 * overlay div that sits on top of the waveform canvas.
 */
export function Waveform({ url, segments, playbackRate, volume, onReady, onTime, onPlayStateChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const durationRef = useRef<number>(0);

  // (re)create wavesurfer when url changes
  useEffect(() => {
    if (!containerRef.current || !url) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      waveColor: "#4a5560",
      progressColor: "#6ea8ff",
      cursorColor: "#fff",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 64,
      normalize: true,
      autoplay: false,
    });
    wsRef.current = ws;

    const onReadyHandler = () => {
      durationRef.current = ws.getDuration();
      ws.setPlaybackRate(playbackRate);
      ws.setVolume(volume);
      onReady(ws, ws.getDuration());
    };
    const onAudioProcess = (time: number) => onTime(time);
    const onSeeking = (time: number) => onTime(time);
    const onPlay = () => onPlayStateChange(true);
    const onPause = () => onPlayStateChange(false);
    // `finish` fires when playback reaches the end — wavesurfer does NOT emit
    // `pause` in that case, so without this the play/pause icon stays stuck on
    // "pause" after a track ends.
    const onFinish = () => onPlayStateChange(false);

    ws.on("ready", onReadyHandler);
    ws.on("audioprocess", onAudioProcess);
    ws.on("timeupdate", onAudioProcess);
    ws.on("seeking", onSeeking);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply playbackRate changes without recreating
  useEffect(() => {
    wsRef.current?.setPlaybackRate(playbackRate);
  }, [playbackRate]);

  // Apply volume changes without recreating
  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  // Segment ticks: positioned by % of duration. Recomputed when segments arrive.
  const duration = durationRef.current;

  return (
    <div className="waveform-wrap">
      <div ref={containerRef} className="waveform" />
      {duration > 0 && segments.length > 0 && (
        <div className="waveform-ticks" aria-hidden>
          {segments.map((s, i) => (
            <div
              key={i}
              className="tick"
              style={{ left: `${(s.start / duration) * 100}%` }}
              title={`${s.start.toFixed(1)}s`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
