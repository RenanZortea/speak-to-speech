import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import type { Segment } from "./api";
import { analyzePlaybackFormants } from "./playbackFormants";
import type { TrackedFormants } from "./formantTracker";

interface Props {
  url: string | null;
  segments: Segment[];
  playbackRate: number;
  volume: number;
  onReady: (ws: WaveSurfer, duration: number) => void;
  onTime: (t: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onPlaybackFormants: (formants: TrackedFormants | null) => void;
  analyzePlayback: boolean;
}

/**
 * Wavesurfer.js-based waveform. Owns playback (replaces the bare <audio> element).
 * Exposes its WaveSurfer instance via onReady so the parent can drive play/pause/seek.
 *
 * Segment boundaries are rendered as thin vertical ticks on an absolutely-positioned
 * overlay div that sits on top of the waveform canvas.
 */
export function Waveform({ url, segments, playbackRate, volume, onReady, onTime, onPlayStateChange, onPlaybackFormants, analyzePlayback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const durationRef = useRef<number>(0);
  const lastAnalysisRef = useRef(-1);
  const smoothedRef = useRef<number[]>([]);
  const analyzePlaybackRef = useRef(analyzePlayback);
  analyzePlaybackRef.current = analyzePlayback;

  useEffect(() => {
    if (!analyzePlayback) onPlaybackFormants(null);
  }, [analyzePlayback, onPlaybackFormants]);

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
    const emitFormants = (time: number, force = false) => {
      if (!force && Math.abs(time - lastAnalysisRef.current) < 0.04) return;
      lastAnalysisRef.current = time;
      const decoded = ws.getDecodedData();
      const measured = decoded ? analyzePlaybackFormants(decoded, time) : null;
      if (!measured) { onPlaybackFormants(null); return; }
      const values = [measured.f1, measured.f2, measured.f3].map((value, i) => {
        const prior = smoothedRef.current[i];
        return prior == null ? value : prior * 0.6 + value * 0.4;
      });
      smoothedRef.current = values;
      onPlaybackFormants({ f1: values[0], f2: values[1], f3: values[2], voiced: true });
    };
    const onAudioProcess = (time: number) => { onTime(time); if (analyzePlaybackRef.current) emitFormants(time); };
    const onSeeking = (time: number) => { onTime(time); smoothedRef.current = []; if (analyzePlaybackRef.current) emitFormants(time, true); };
    const onPlay = () => onPlayStateChange(true);
    const onPause = () => { onPlayStateChange(false); onPlaybackFormants(null); };
    // `finish` fires when playback reaches the end — wavesurfer does NOT emit
    // `pause` in that case, so without this the play/pause icon stays stuck on
    // "pause" after a track ends.
    const onFinish = () => { onPlayStateChange(false); onPlaybackFormants(null); };

    ws.on("ready", onReadyHandler);
    ws.on("audioprocess", onAudioProcess);
    ws.on("timeupdate", onAudioProcess);
    ws.on("seeking", onSeeking);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);

    return () => {
      onPlaybackFormants(null);
      onPlayStateChange(false);
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
