import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Bookmark, RotateCcw, Snail, Turtle, Play, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { YouTubeVideo } from './youtube';
import { loadYouTubeApi, type YouTubePlayer as Player } from './youtubePlayer';

import type { RecordingController } from "./Recorder";

export function YouTubePlayer({ video, recorder, active }: { video: YouTubeVideo; recorder: RecordingController; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [rates, setRates] = useState<number[]>([]);
  const [error, setError] = useState('');
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) player.current?.pauseVideo();
  }, [active]);

  useEffect(() => {
    let disposed = false;
    let instance: Player | null = null;
    const refresh = (target: Player) => {
      if (disposed) return;
      setRate(target.getPlaybackRate());
      setRates(target.getAvailablePlaybackRates());
    };
    const timeout = window.setTimeout(() => {
      if (!disposed) setError('The video is taking too long to load. Check your connection and load it again.');
    }, 25000);
    void loadYouTubeApi().then((api) => {
      if (disposed || !host.current) return;
      // Keep the API-owned iframe inside a React-owned container for safe cleanup.
      const mount = document.createElement('div');
      host.current.appendChild(mount);
      instance = new api.Player(mount, {
        videoId: video.id,
        playerVars: { start: video.start, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }) => {
            if (disposed) return;
            window.clearTimeout(timeout);
            player.current = target;
            setReady(true);
            setError('');
            refresh(target);
          },
          onPlaybackRateChange: ({ target }) => refresh(target),
          onStateChange: ({ target }) => refresh(target),
          onError: ({ data }) => {
            if (disposed) return;
            window.clearTimeout(timeout);
            setReady(false);
            setError(`YouTube could not play this video (error ${data}). Try another video that allows embedding.`);
          },
        },
      });
    }).catch((reason: Error) => {
      if (!disposed) { window.clearTimeout(timeout); setError(reason.message); }
    });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      player.current = null;
      instance?.destroy();
    };
  }, [video.id, video.start]);

  const recording = recorder.state.kind === 'recording';
  const wasRecording = useRef(recording);
  useEffect(() => {
    // Both the video toolbar and Source panel control the shared recorder.
    if (wasRecording.current && !recording) player.current?.pauseVideo();
    wasRecording.current = recording;
  }, [recording]);
  const pending = recorder.state.kind === 'requesting' || recorder.state.kind === 'uploading';
  const playAndRecord = async () => {
    if (recording) {
      recorder.stop();
      player.current?.pauseVideo();
      return;
    }
    const target = player.current;
    if (!ready || !target || !recorder.canStart || pending) return;
    // Hold the video at the checkpoint while microphone permission is requested.
    target.pauseVideo();
    if (checkpoint !== null) target.seekTo(checkpoint, true);
    if (await recorder.start()) {
      if (player.current === target && activeRef.current) target.playVideo();
      // The shared Source controls remain available if this player was closed.
    }
  };

  const seekBy = (seconds: number) => {
    const target = player.current;
    if (!ready || !target) return;
    const time = target.getCurrentTime();
    const duration = target.getDuration();
    if (!Number.isFinite(time)) return;
    const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    target.seekTo(Math.min(end, Math.max(0, time + seconds)), true);
  };

  const setPoint = () => {
    if (checkpoint !== null) {
      player.current?.seekTo(checkpoint, true);
      return;
    }
    const time = player.current?.getCurrentTime();
    if (time !== undefined && Number.isFinite(time)) setCheckpoint(time);
  };

  return <div className="youtube-workspace">
    <div className="youtube-video-area">
      <div className="youtube-player-host" ref={host} />
      {error && <p className="youtube-error" role="alert">{error}</p>}
    </div>
    <aside className="youtube-controls" aria-label="Video practice controls">
      <button className={`youtube-icon youtube-record ${recording ? 'active' : ''}`}
        disabled={!recording && (!ready || !recorder.canStart || pending)}
        title={recording ? 'Stop recording' : pending ? 'Preparing recording…' : 'Play and record'}
        aria-label={recording ? 'Stop recording' : 'Play and record'}
        onClick={() => void playAndRecord()}>
        {recording ? <Square size={17} fill="currentColor" /> : pending ? <Loader2 size={17} className="spin" /> : <Mic size={17} />}
      </button>
      <div className="youtube-checkpoint-actions">
        <button className={`youtube-icon ${checkpoint !== null ? 'active' : ''}`}
          onClick={setPoint} disabled={!ready}
          title={checkpoint === null ? 'Set checkpoint' : `Jump to checkpoint (${Math.floor(checkpoint / 60)}:${Math.floor(checkpoint % 60).toString().padStart(2, '0')})`}
          aria-label={checkpoint === null ? 'Set checkpoint' : 'Jump to checkpoint'}>
          <Bookmark size={17} fill={checkpoint !== null ? 'currentColor' : 'none'} />
        </button>
        {checkpoint !== null && <button className="youtube-icon youtube-checkpoint-reset" disabled={!ready}
          onClick={() => setCheckpoint(null)}
          title="Clear checkpoint" aria-label="Clear checkpoint">
          <RotateCcw size={14} />
        </button>}
      </div>
      <div className="youtube-seek" role="group" aria-label="Seek video">
        {[
          { direction: -1, label: 'Back', Icon: ChevronLeft, FastIcon: ChevronsLeft },
          { direction: 1, label: 'Forward', Icon: ChevronRight, FastIcon: ChevronsRight },
        ].map(({ direction, label, Icon, FastIcon }) => <div className="youtube-seek-row" key={direction}>
          <button className="youtube-icon" disabled={!ready}
            title={`${label} 1 second`} aria-label={`${label} 1 second`}
            onClick={() => seekBy(direction)}><Icon size={17} /></button>
          <button className="youtube-icon" disabled={!ready}
            title={`${label} 5 seconds`} aria-label={`${label} 5 seconds`}
            onClick={() => seekBy(direction * 5)}><FastIcon size={17} /></button>
        </div>)}
      </div>
      <div className="youtube-speeds" role="group" aria-label="Playback speed">
        {([{ speed: 0.25, Icon: Snail }, { speed: 0.5, Icon: Turtle }, { speed: 1, Icon: Play }]).map(({ speed, Icon }) => <button key={speed}
          className={`youtube-icon ${rate === speed && ready ? 'active' : ''}`}
          disabled={!ready || !rates.includes(speed)} aria-pressed={ready && rate === speed}
          aria-label={`${speed}× speed`}
          title={ready && !rates.includes(speed) ? `${speed}× unavailable for this video` : `${speed}× speed`}
          onClick={() => player.current?.setPlaybackRate(speed)}><Icon size={17} /></button>)}
      </div>
    </aside>
  </div>;
}
