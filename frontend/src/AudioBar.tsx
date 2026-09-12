import { bindPlaybackLoop } from "./playbackLoop";
import { useEffect, useRef, useState, type ReactNode } from "react";
import WaveSurfer from "wavesurfer.js";
import { AudioLines, FileText, Pause, Play, Trash2, Volume1, Volume2, VolumeX } from "lucide-react";
import { playAudio } from "./playAudio";
import { Waveform } from "./Waveform";
import type { Segment } from "./api";
import type { CorrectionView } from "./CodeTranscript";
import type { TrackedFormants } from "./formantTracker";

interface Props {
  onClear?: () => void;
  clearDisabled?: boolean;
  transcriptionRequest?: number;
  compact?: boolean;
  compactStage?: boolean;
  actions?: ReactNode;
  stage?: ReactNode;
  showStage?: boolean;
  url: string | null;
  /** Changes whenever /audio points at a different file, even though its URL is stable. */
  sourceKey: number;
  segments: Segment[];
  currentTime: number;
  onTimeChange: (t: number) => void;
  /** Callback registered by parent; parent uses this to seek when a transcript segment is clicked. */
  registerSeek: (fn: ((t: number) => void) | null) => void;
  /** Corrected/Original toggle — only rendered once the transcript has corrections. */
  hasCorrections: boolean;
  correctionView: CorrectionView;
  onCorrectionViewChange: (v: CorrectionView) => void;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackFormants: (formants: TrackedFormants | null) => void;
  analyzePlayback: boolean;
}

const SPEEDS = [0.5, 0.75, 1];

export function AudioBar({
  onClear,
  clearDisabled = false,
  transcriptionRequest = 0,
  compact = false,
  compactStage = false,
  actions,
  stage,
  showStage = false,
  url,
  sourceKey,
  segments,
  currentTime,
  onTimeChange,
  registerSeek,
  hasCorrections,
  correctionView,
  onCorrectionViewChange,
  onPlayingChange,
  onPlaybackFormants,
  analyzePlayback,
}: Props) {
  const wsRef = useRef<WaveSurfer | null>(null);
  const loopCleanupRef = useRef<(() => void) | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const play = (ws: WaveSurfer) => { void playAudio(ws).catch((e: Error) => setError(e.message)); };
  const [duration, setDuration] = useState(0);
  const [playerView, setPlayerView] = useState<"waveform" | "transcript">("waveform");
  const displayStage = showStage && playerView === "transcript";
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const prevVolumeRef = useRef(1);
  const [loopSeg, setLoopSeg] = useState<Pick<Segment, "start" | "end"> | null>(null);

  const toggleMute = () => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(prevVolumeRef.current || 0.7);
    }
  };

  const VolumeIcon = volume === 0 ? VolumeX : volume <= 0.5 ? Volume1 : Volume2;

  // Wire up the seek function for the parent (Transcript clicks).
  useEffect(() => {
    registerSeek((t: number) => {
      const ws = wsRef.current;
      if (!ws || !ws.getDuration()) {
        pendingSeekRef.current = t;
        return;
      }
      loopCleanupRef.current?.();
      loopCleanupRef.current = null;
      setLoopSeg(null);
      ws.setTime(t);
      play(ws);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  // The child owns instance creation and invalidation, including StrictMode cleanup.
  const onInstance = (instance: WaveSurfer | null) => {
    wsRef.current = instance;
    setDuration(0);
    setPlaying(false);
    setLoopSeg(null);
    if (instance) setError(null);
  };

  const onReady = (ws: WaveSurfer, dur: number) => {
    wsRef.current = ws;
    setDuration(dur);
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek != null) {
      pendingSeekRef.current = null;
      ws.setTime(pendingSeek);
      play(ws);
    } else if (currentTime > 0) {
      ws.setTime(Math.min(currentTime, dur));
    }
  };

  useEffect(() => {
    if (transcriptionRequest > 0) setPlayerView("transcript");
  }, [transcriptionRequest]);

  useEffect(() => { setPlayerView("waveform"); }, [sourceKey]);

  // Preserve the selection while the transcript is visible, but detach playback looping.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !loopSeg || displayStage) return;
    const cleanup = bindPlaybackLoop(ws, loopSeg, () => play(ws));
    loopCleanupRef.current = cleanup;
    return () => { cleanup(); if (loopCleanupRef.current === cleanup) loopCleanupRef.current = null; };
  }, [loopSeg, displayStage]);

  const togglePlay = () => {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else play(ws);
  };

  if (!url) {
    return (
      <div className="audio-bar audio-bar-empty">
        <span>No audio loaded — pick a file or record below.</span>
      </div>
    );
  }

  return (
    <section className={`audio-player ${compact ? "compact-player" : ""}`} aria-label="Audio player">
      {!compact && <button className="player-view-toggle"
        disabled={!showStage} onClick={() => setPlayerView(displayStage ? "waveform" : "transcript")}
        title={displayStage ? "Show waveform" : "Show transcription"}
        aria-label={displayStage ? "Show waveform" : "Show transcription"}>
        {displayStage ? <AudioLines size={14} /> : <FileText size={14} />}
      </button>}
      <div className={`player-stage ${displayStage ? "show-content" : ""} ${compactStage ? "small-stage" : ""}`}>
      <div className="ab-wave" aria-hidden={displayStage}>
        <Waveform
          key={retry}
          onError={setError}
          onInstance={onInstance}
          url={url}
          sourceKey={sourceKey}
          loop={loopSeg}
          onLoopChange={(region) => {
            setLoopSeg(region);
            if (region && wsRef.current) {
              wsRef.current.setTime(region.start);
              play(wsRef.current);
            }
          }}
          segments={segments}
          playbackRate={speed}
          height={compactStage ? 64 : 280}
          volume={volume}
          onReady={onReady}
          onTime={onTimeChange}
          onPlayStateChange={(next) => { setPlaying(next); onPlayingChange(next); }}
          onPlaybackFormants={onPlaybackFormants}
          analyzePlayback={analyzePlayback}
        />
      </div>

      <div className="player-stage-content">{stage}</div>
      </div>
      {error && <div className="rec-error" role="alert">Audio playback failed: {error}<button className="btn ghost" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Retry audio</button></div>}
      <div className="player-dock">
      <div className="player-actions">{actions}</div>
    <div className="audio-bar">
      <button
        className="ab-btn ab-play"
        onClick={togglePlay}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause audio" : "Play audio"}
        disabled={duration === 0}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <div className="ab-volume">
        <button
          className="ab-vol-icon"
          onClick={toggleMute}
          title={volume === 0 ? "Unmute" : "Mute"}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
        >
          <VolumeIcon size={16} />
        </button>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="ab-vol-slider"
          title={`Volume ${Math.round(volume * 100)}%`}
        />
      </div>

      <div className="ab-time">
        <span className="ab-time-cur">{fmt(currentTime)}</span>
        <span className="ab-time-sep">/</span>
        <span className="ab-time-dur">{fmt(duration)}</span>
      </div>

      <div className="ab-speed" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`ab-speed-btn ${speed === s ? "active" : ""}`}
            aria-pressed={speed === s}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      {onClear && <button type="button" className="ab-btn ab-clear"
        aria-label="Clear recording" title="Clear recording" disabled={clearDisabled} onClick={onClear}>
        <Trash2 size={16} />
      </button>}

      {hasCorrections && (
        <div className="corr-toggle">
          <button
            className={correctionView === "corrected" ? "active" : ""}
            onClick={() => onCorrectionViewChange("corrected")}
          >
            Corrected
          </button>
          <button
            className={correctionView === "original" ? "active" : ""}
            onClick={() => onCorrectionViewChange("original")}
          >
            Original
          </button>
        </div>
      )}
    </div>
      </div>
    </section>
  );
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
