import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { AUDIO_OUTPUT_CHANGED, speakerDevice } from "./audioDevices";
import WaveSurfer from "wavesurfer.js";
import type { Segment } from "./api";
import { analyzePlaybackFormants } from "./playbackFormants";
import type { TrackedFormants } from "./formantTracker";

interface Props {
  loop?: { start: number; end: number } | null;
  onLoopChange?: (region: { start: number; end: number } | null) => void;
  url: string | null;
  sourceKey: number;
  segments: Segment[];
  playbackRate: number;
  height?: number;
  volume: number;
  onReady: (ws: WaveSurfer, duration: number) => void;
  onTime: (t: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onPlaybackFormants: (formants: TrackedFormants | null) => void;
  analyzePlayback: boolean;
  onInstance?: (instance: WaveSurfer | null) => void;
  onError?: (message: string) => void;
}

/**
 * Wavesurfer.js-based waveform. Owns playback (replaces the bare <audio> element).
 * Exposes its WaveSurfer instance via onReady so the parent can drive play/pause/seek.
 *
 * Segment boundaries are rendered as thin vertical ticks on an absolutely-positioned
 * overlay div that sits on top of the waveform canvas.
 */
export function Waveform({ loop = null, onLoopChange, url, sourceKey, segments, playbackRate, height = 280, volume, onReady, onTime, onPlayStateChange, onPlaybackFormants, analyzePlayback, onError, onInstance }: Props) {
  const latest = useRef({ onReady, onTime, onPlayStateChange, onPlaybackFormants, onError, onInstance, playbackRate, volume });
  latest.current = { onReady, onTime, onPlayStateChange, onPlaybackFormants, onError, onInstance, playbackRate, volume };
  const dragRef = useRef<{ pointerId: number; x: number; start: number; end: number; moved: boolean } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const pointerTime = (event: PointerEvent<HTMLDivElement>) => {
    const ws = wsRef.current;
    if (!ws || !ws.getDecodedData()) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pixelsPerSecond = Math.max(zoomRef.current, ws.getWidth() / ws.getDuration());
    return Math.max(0, Math.min(ws.getDuration(), (ws.getScroll() + Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))) / pixelsPerSecond));
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [atEndpoint, setAtEndpoint] = useState(true);
  const [zoom, setZoom] = useState(() => {
    try {
      const saved = Number(globalThis.localStorage?.getItem("waveformZoom"));
      return Number.isFinite(saved) && saved >= 1 && saved <= 32 ? saved : 4;
    } catch { return 4; }
  });
  useEffect(() => {
    try { globalThis.localStorage?.setItem("waveformZoom", String(zoom)); } catch { /* Storage may be unavailable. */ }
  }, [zoom]);
  const zoomRef = useRef(80);
  const targetZoomRef = useRef(zoom);
  targetZoomRef.current = zoom;
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
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

    // Keep native playback on the range-capable server URL. WaveSurfer otherwise
    // replaces it with a blob URL, bypassing HTTP byte-range seeking in
    // WebKit's GStreamer pipeline.
    // An external media element already using this URL makes setSrc retain it.
    // Leave src empty during creation to prevent WaveSurfer's automatic load
    // from racing with the explicit load after our handlers are attached.
    const media = new Audio();
    media.preload = "auto";
    const ws = WaveSurfer.create({
      media,
      container: containerRef.current,
      // Native media playback preserves pitch when slowing down; WebAudio resamples.
      backend: "MediaElement",
      waveColor: "#737373",
      progressColor: "#fafafa",
      cursorColor: "#fff",
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 2,
      height,
      minPxPerSec: 0,
      autoScroll: true,
      autoCenter: true,
      hideScrollbar: true,
      normalize: true,
      autoplay: false,
    });
    wsRef.current = ws;
    const container = containerRef.current;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !ws.getDecodedData()) return;
      const width = ws.getWidth();
      if (ws.getDuration() * zoomRef.current <= width) return;
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      ws.setScroll(ws.getScroll() + delta * unit);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    let disposed = false;
    const applyOutput = () => {
      const media = ws.getMediaElement();
      if (!("setSinkId" in media)) return;
      void media.setSinkId(speakerDevice()).catch(() => {
        if (!disposed) latest.current.onError?.("Could not use the selected speaker. Choose System default in speaker settings.");
      });
    };
    applyOutput();
    window.addEventListener(AUDIO_OUTPUT_CHANGED, applyOutput);
    setVisibleRange({ start: 0, end: 0 });
    setAtEndpoint(true);
    dragRef.current = null;
    setSelection(null);
    latest.current.onInstance?.(ws);

    const updateVisibleRange = () => {
      if (disposed) return;
      const duration = ws.getDuration();
      const width = ws.getWidth();
      const pixelsPerSecond = Math.max(zoomRef.current, duration > 0 ? width / duration : 0);
      const start = ws.getScroll() / pixelsPerSecond;
      setVisibleRange({ start, end: start + width / pixelsPerSecond });
    };
    const onReadyHandler = () => {
      if (disposed) return;
      zoomRef.current = ws.getWidth() / ws.getDuration() * targetZoomRef.current;
      ws.zoom(zoomRef.current);
      updateVisibleRange();
      ws.setPlaybackRate(latest.current.playbackRate, true);
      ws.setVolume(latest.current.volume);
      latest.current.onReady(ws, ws.getDuration());
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
    const updateCursor = (time: number) => setAtEndpoint(time <= 0.001 || time >= ws.getDuration() - 0.001);
    const onAudioProcess = (time: number) => { updateCursor(time); latest.current.onTime(time); if (analyzePlaybackRef.current) emitFormants(time); };
    const onSeeking = (time: number) => { updateCursor(time); latest.current.onTime(time); smoothedRef.current = []; if (analyzePlaybackRef.current) emitFormants(time, true); };
    const onPlay = () => latest.current.onPlayStateChange(true);
    const onPause = () => { latest.current.onPlayStateChange(false); onPlaybackFormants(null); };
    // `finish` fires when playback reaches the end — wavesurfer does NOT emit
    // `pause` in that case, so without this the play/pause icon stays stuck on
    // "pause" after a track ends.
    const onFinish = () => { setAtEndpoint(true); latest.current.onPlayStateChange(false); onPlaybackFormants(null); };

    ws.on("error", (error) => { if (!disposed) latest.current.onError?.(error.message); });
    ws.on("ready", onReadyHandler);
    ws.on("scroll", (start, end) => setVisibleRange({ start, end }));
    ws.on("redrawcomplete", updateVisibleRange);
    ws.on("resize", () => {
      if (ws.getDecodedData() && ws.getDuration() > 0 && ws.getWidth() > 0) {
        zoomRef.current = ws.getWidth() / ws.getDuration() * targetZoomRef.current;
        ws.zoom(zoomRef.current);
      }
      updateVisibleRange();
    });
    ws.on("audioprocess", onAudioProcess);
    ws.on("timeupdate", onAudioProcess);
    ws.on("seeking", onSeeking);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);

    // Assign src after creation so setSrc keeps HTTP playback, without triggering
    // a second load from WaveSurfer's constructor.
    media.src = url;
    void ws.load(url).catch((error: Error) => { if (!disposed) latest.current.onError?.(error.message); });

    return () => {
      disposed = true;
      window.removeEventListener(AUDIO_OUTPUT_CHANGED, applyOutput);
      container.removeEventListener("wheel", onWheel);
      latest.current.onInstance?.(null);
      onPlaybackFormants(null);
      latest.current.onPlayStateChange(false);
      ws.destroy();
      // WaveSurfer leaves external media lifecycle management to its owner.
      media.pause();
      media.removeAttribute("src");
      media.load();
      wsRef.current = null;
    };
  }, [url, sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ws.getDecodedData() || !ws.getDuration()) return;
    const width = ws.getWidth();
    const duration = ws.getDuration();
    const from = Math.max(zoomRef.current, width / duration);
    const target = width / duration * zoom;
    const playheadX = ws.getCurrentTime() * from - ws.getScroll();
    const anchorX = playheadX >= 0 && playheadX <= width ? playheadX : width / 2;
    const anchorTime = (ws.getScroll() + anchorX) / from;
    let frame = 0;
    const started = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = (now: number) => {
      const progress = reducedMotion ? 1 : Math.min(1, (now - started) / 180);
      zoomRef.current = from + (target - from) * (1 - Math.pow(1 - progress, 3));
      ws.zoom(zoomRef.current);
      ws.setScroll(Math.max(0, Math.min(duration * zoomRef.current - width, anchorTime * zoomRef.current - anchorX)));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    if (from !== target) frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [zoom, url, sourceKey]);

  // Resize for the active workspace without interrupting playback.
  useEffect(() => {
    wsRef.current?.setOptions({ height });
  }, [height]);

  // Apply playbackRate changes without recreating
  useEffect(() => {
    wsRef.current?.setPlaybackRate(playbackRate, true);
  }, [playbackRate]);

  // Apply volume changes without recreating
  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  const highlighted = selection ?? loop;
  const visibleDuration = visibleRange.end - visibleRange.start;

  return (
    <div className={`waveform-wrap ${atEndpoint ? "waveform-at-endpoint" : ""}`}>
      <div className="waveform-loop-controls">
        <button type="button" className={loop ? "remove-loop visible" : "remove-loop"}
          disabled={!loop} tabIndex={loop ? 0 : -1} aria-hidden={!loop}
          onClick={() => onLoopChange?.(null)}>Remove loop</button>
      </div>
      <div className="waveform-viewport"
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const time = pointerTime(event);
          if (time == null) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, start: time, end: time, moved: false };
        }}
        onPointerMoveCapture={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.stopPropagation();
          drag.end = pointerTime(event) ?? drag.end;
          drag.moved ||= Math.abs(event.clientX - drag.x) >= 4;
          if (drag.moved) setSelection({ start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) });
        }}
        onPointerUpCapture={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.stopPropagation();
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          setSelection(null);
          if (drag.moved) {
            const region = { start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) };
            if (region.end - region.start >= 0.05) onLoopChange?.(region);
          } else {
            onLoopChange?.(null);
            wsRef.current?.setTime(drag.start);
          }
        }}
        onPointerCancel={() => { dragRef.current = null; setSelection(null); }}
        onLostPointerCapture={() => { dragRef.current = null; setSelection(null); }}
        onClickCapture={(event) => event.stopPropagation()}>
      {highlighted && visibleDuration > 0 && <div className="waveform-loop-region" aria-hidden style={{
        left: `${(highlighted.start - visibleRange.start) / visibleDuration * 100}%`,
        width: `${(highlighted.end - highlighted.start) / visibleDuration * 100}%`,
      }} />}

      <div ref={containerRef} className="waveform" style={{ height: "auto" }} />
      {visibleDuration > 0 && segments.length > 0 && (
        <div className="waveform-ticks" aria-hidden>
          {segments.filter((s) => s.start >= visibleRange.start && s.start <= visibleRange.end).map((s, i) => (
            <div
              key={i}
              className="tick"
              style={{ left: `${((s.start - visibleRange.start) / visibleDuration) * 100}%` }}
              title={`${s.start.toFixed(1)}s`}
            />
          ))}
        </div>
      )}
      </div>
      <label className="waveform-zoom">
        <span>Zoom</span>
        <input type="range" min={0} max={5} step={0.01} value={Math.log2(zoom)}
          style={{ "--zoom-fill": `${Math.log2(zoom) / 5 * 100}%` } as CSSProperties}
          aria-label="Waveform zoom" aria-valuetext={`${zoom.toFixed(1)}×`}
          onChange={(event) => setZoom(2 ** Number(event.target.value))} />
        <span>{zoom.toFixed(1)}×</span>
      </label>
    </div>
  );
}
