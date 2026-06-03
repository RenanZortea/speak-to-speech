import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "lucide-react";
import { Waveform } from "./Waveform";
import type { Segment } from "./api";

interface Props {
  url: string | null;
  segments: Segment[];
  currentTime: number;
  onTimeChange: (t: number) => void;
  /** Callback registered by parent; parent uses this to seek when a transcript segment is clicked. */
  registerSeek: (fn: ((t: number) => void) | null) => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

export function AudioBar({ url, segments, currentTime, onTimeChange, registerSeek }: Props) {
  const wsRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const prevVolumeRef = useRef(1);
  const [loopSeg, setLoopSeg] = useState<Segment | null>(null);

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
      if (!ws) return;
      ws.setTime(t);
      void ws.play();
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  const onReady = (ws: WaveSurfer, dur: number) => {
    wsRef.current = ws;
    setDuration(dur);
  };

  // Loop logic: if loopSeg is set, snap back to its start when we cross its end.
  useEffect(() => {
    if (!loopSeg) return;
    if (currentTime >= loopSeg.end - 0.02) {
      wsRef.current?.setTime(loopSeg.start);
    }
  }, [currentTime, loopSeg]);

  const togglePlay = () => {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else void ws.play();
  };

  const activeIdx = segments.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end,
  );
  const activeSeg = activeIdx >= 0 ? segments[activeIdx] : null;
  const loopOnActive = loopSeg != null && activeSeg != null && loopSeg.start === activeSeg.start;

  const toggleLoop = () => {
    if (loopOnActive) {
      setLoopSeg(null);
    } else if (activeSeg) {
      setLoopSeg(activeSeg);
      // jump to start of the segment for an immediate replay
      wsRef.current?.setTime(activeSeg.start);
      void wsRef.current?.play();
    }
  };

  if (!url) {
    return (
      <div className="audio-bar audio-bar-empty">
        <span>No audio loaded — pick a file or record below.</span>
      </div>
    );
  }

  return (
    <div className="audio-bar">
      <button
        className="ab-btn ab-play"
        onClick={togglePlay}
        title={playing ? "Pause (space)" : "Play (space)"}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <div className="ab-volume">
        <button
          className="ab-vol-icon"
          onClick={toggleMute}
          title={volume === 0 ? "Unmute" : "Mute"}
        >
          <VolumeIcon size={16} />
        </button>
        <input
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

      <div className="ab-wave">
        <Waveform
          url={url}
          segments={segments}
          playbackRate={speed}
          volume={volume}
          onReady={onReady}
          onTime={onTimeChange}
          onPlayStateChange={setPlaying}
        />
      </div>

      <div className="ab-time">
        <span className="ab-time-cur">{fmt(currentTime)}</span>
        <span className="ab-time-sep">/</span>
        <span className="ab-time-dur">{fmt(duration)}</span>
      </div>

      <div className="ab-speed" title="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`ab-speed-btn ${speed === s ? "active" : ""}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <button
        className={`ab-btn ab-loop ${loopOnActive ? "active" : ""}`}
        onClick={toggleLoop}
        disabled={!activeSeg}
        title={
          !activeSeg
            ? "Position playback inside a segment to loop it"
            : loopOnActive
            ? "Stop looping"
            : "Loop current segment"
        }
      >
        <Repeat size={16} />
      </button>
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
