import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ArrowLeftRight, Mic, Square, Loader2, Bookmark, RotateCcw, Snail, Turtle, Play, Pause, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { api, type MediaCommand, type NativeMediaState } from './api';
import { NativeMediaHost } from './NativeMediaHost';
import { practiceShortcut, isEditing, PRACTICE_ACTIONS, type PracticeAction } from './mediaShortcuts';
import type { RecordingController } from './Recorder';

export function NativeYouTubePlayer({ recorder, active }: { recorder: RecordingController; active: boolean }) {
  const [playback, setPlayback] = useState<NativeMediaState>({});
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const alive = useRef(true);
  const startingRef = useRef(false);
  const revision = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ready = active && !!playback.available && !playback.signingIn;
  const rate = playback.rate ?? 1;
  const checkpointRef = useRef<number | null>(null);
  const previousRate = useRef(1);
  const observedRate = useRef(1);
  const actionQueue = useRef(Promise.resolve());
  const actionGeneration = useRef(0);
  const queuedActions = useRef(0);
  useEffect(() => { actionGeneration.current++; }, [active]);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const observeRate = (state: NativeMediaState) => {
    if (state.available && Number.isFinite(state.rate) && state.rate !== observedRate.current) {
      previousRate.current = observedRate.current;
      observedRate.current = state.rate!;
    }
  };
  const updateCheckpoint = (value: number | null) => {
    checkpointRef.current = value; setCheckpoint(value);
  };
  const canControl = () => alive.current && activeRef.current && readyRef.current
    && !document.querySelector('.modal-overlay, dialog[open], .toolbar-menu[open]');
  const recording = recorder.state.kind === 'recording' || recorder.state.kind === 'paused';
  const pending = starting || recorder.state.kind === 'requesting' || recorder.state.kind === 'uploading';

  const run = async (action: MediaCommand, value = 0) => {
    const request = ++revision.current;
    try {
      const state = await api.mediaCommand(action, value);
      if (alive.current && request === revision.current) { observeRate(state); setPlayback(state); setError(state.error ?? ''); }
      return state;
    } catch (reason) {
      if (alive.current && request === revision.current) setError(reason instanceof Error ? reason.message : 'Video control failed.');
      return null;
    }
  };
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const request = revision.current;
      try {
        const state = await api.mediaCommand('status');
        if (!disposed && request === revision.current) { observeRate(state); setPlayback(state); setError(state.error ?? ''); }
      } catch (reason) {
        if (!disposed && request === revision.current) { setPlayback({}); setError(reason instanceof Error ? reason.message : 'Could not read video status.'); }
      }
      if (!disposed) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active]);
  const previousKind = useRef(recorder.state.kind);
  useEffect(() => {
    if (previousKind.current === 'recording' && recorder.state.kind !== 'recording') void run('pause');
    previousKind.current = recorder.state.kind;
  }, [recorder.state.kind]);

  const playAndRecord = async () => {
    if (recording) { recorder.stop(); await run('pause'); return; }
    if (!ready || !recorder.canStart || pending || startingRef.current) return;
    startingRef.current = true; setStarting(true);
    try {
      const paused = await run('pause');
      if (!paused?.available || paused.signingIn || !activeRef.current || !alive.current) return;
      if (checkpoint !== null && !await run('seek_to', checkpoint)) return;
      if (!activeRef.current || !alive.current) return;
      if (await recorder.start()) {
        if (activeRef.current && alive.current) await run('play');
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'Could not start recording.');
    } finally { startingRef.current = false; if (alive.current) setStarting(false); }
  };
  const seekBy = (seconds: number) => { void run('seek', seconds); };
  // Serialize status + mutation so held keys and quick button presses cannot
  // calculate several increments from the same stale polling result.
  const practice = (action: PracticeAction | 'set-speed' | 'clear-checkpoint', value = 0) => {
    if (!canControl() || queuedActions.current >= 32) return;
    const generation = actionGeneration.current;
    const valid = () => generation === actionGeneration.current && canControl();
    queuedActions.current++;
    actionQueue.current = actionQueue.current.then(async () => {
      if (!valid()) return;
      if (action === 'clear-checkpoint') { updateCheckpoint(null); return; }
      const state = await run('status');
      if (!valid() || !state?.available || state.signingIn) return;
      if (action === 'set-checkpoint') {
        if (Number.isFinite(state.time)) updateCheckpoint(state.time!);
      } else if (action === 'jump-checkpoint') {
        if (checkpointRef.current !== null) await run('seek_to', checkpointRef.current);
      } else {
        const current = state.rate ?? 1;
        const next = action === 'set-speed' ? value : action === 'toggle-speed'
          ? (current === 1 ? previousRate.current : 1)
          : Math.round((current + (action === 'slower' ? -0.1 : 0.1)) * 100) / 100;
        await run('rate', Math.max(0.25, Math.min(2, next)));
      }
    }).catch(reason => {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'Video control failed.');
    }).finally(() => { queuedActions.current--; });
  };
  const shortcutHandler = useRef(practice);
  shortcutHandler.current = practice;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!canControl() || event.defaultPrevented || isEditing(event.target)) return;
      const action = practiceShortcut(event);
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      shortcutHandler.current(action);
    };
    const nativeShortcut = (event: Event) => {
      const action = (event as CustomEvent).detail;
      if (canControl() && PRACTICE_ACTIONS.includes(action)) shortcutHandler.current(action);
    };
    const dialogs = new MutationObserver(() => {
      if (document.querySelector('.modal-overlay, dialog[open], .toolbar-menu[open]')) actionGeneration.current++;
    });
    dialogs.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open']});
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('media-practice-shortcut', nativeShortcut);
    return () => {
      dialogs.disconnect();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('media-practice-shortcut', nativeShortcut);
    };
  }, []);
  const setPoint = () => practice(checkpointRef.current === null ? 'set-checkpoint' : 'jump-checkpoint');

  return <div className="youtube-workspace">
    <div className="youtube-video-area">
      <NativeMediaHost active={active} />
      <p className="youtube-status" role="status">{playback.signingIn ? 'Finish signing in, then close the sign-in window.'
        : ready ? `${Math.floor(playback.time ?? 0)}s / ${Math.floor(playback.duration ?? 0)}s`
        : 'Loading video… If it remains unavailable, try signing in or reload the link.'}</p>
      {error && <p className="youtube-error" role="alert">{error}</p>}
    </div>
    <aside className="youtube-controls" aria-label="Video practice controls">
      <button className="youtube-icon" disabled={!ready} title={playback.paused ? 'Play video' : 'Pause video'}
        aria-label={playback.paused ? 'Play video' : 'Pause video'}
        onClick={() => void run(playback.paused ? 'play' : 'pause')}>
        {playback.paused ? <Play size={17} /> : <Pause size={17} />}
      </button>
      <button className={`youtube-icon youtube-record ${recording ? 'active' : ''}`}
        disabled={!recording && (!ready || !recorder.canStart || pending)}
        title={recording ? 'Stop recording' : pending ? 'Preparing recording…' : 'Play and record'}
        aria-label={recording ? 'Stop recording' : 'Play and record'}
        onClick={() => void playAndRecord()}>
        {recording ? <Square size={17} fill="currentColor" /> : pending ? <Loader2 size={17} className="spin" /> : <Mic size={17} />}
      </button>
      <div className="youtube-checkpoint-actions">
        <button className={`youtube-icon ${checkpoint !== null ? 'active' : ''}`}
          onClick={event => event.shiftKey ? practice('set-checkpoint') : setPoint()} disabled={!ready}
          title={checkpoint === null ? 'Set checkpoint (Shift + . on Dvorak / Shift + W)' : `Jump to checkpoint (${Math.floor(checkpoint / 60)}:${Math.floor(checkpoint % 60).toString().padStart(2, '0')}) — . on Dvorak / W; Shift + click to replace`}
          aria-label={checkpoint === null ? 'Set checkpoint' : 'Jump to checkpoint'}>
          <Bookmark size={17} fill={checkpoint !== null ? 'currentColor' : 'none'} />
        </button>
        {checkpoint !== null && <button className="youtube-icon youtube-checkpoint-reset" disabled={!ready}
          onClick={() => practice('clear-checkpoint')}
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
          disabled={!ready} aria-pressed={ready && rate === speed}
          aria-label={`${speed}× speed`}
          title={`${speed}× speed`}
          onClick={() => practice('set-speed', speed)}><Icon size={17} /></button>)}
        <div className="youtube-speed-adjust">
        <output className="youtube-current-speed" aria-label="Current playback speed">{rate}×</output>
        <button className="youtube-icon" disabled={!ready} onClick={() => practice('toggle-speed')}
          aria-label="Toggle normal speed" title="Toggle 1× / previous speed (o on Dvorak / S)"><ArrowLeftRight size={17} /></button>
        </div>
        <div className="youtube-speed-adjust">
        <button className="youtube-icon" disabled={!ready || rate <= 0.25} onClick={() => practice('slower')}
          aria-label="Decrease playback speed" title="Slower by 0.1× (a on Dvorak / A)"><Minus size={17} /></button>
        <button className="youtube-icon" disabled={!ready || rate >= 2} onClick={() => practice('faster')}
          aria-label="Increase playback speed" title="Faster by 0.1× (e on Dvorak / D)"><Plus size={17} /></button>
        </div>
      </div>
    </aside>
  </div>;
}
