import { useEffect, useRef, useState } from 'react';
import { loadSpotifyApi, spotifySeekTarget, type SpotifyController, type SpotifyPlayback } from './spotifyPlayer';
import type { RecordingController } from './Recorder';

export function SpotifyPlayer({ url, recorder }: { url: string; recorder: RecordingController }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<SpotifyController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [playback, setPlayback] = useState<SpotifyPlayback | null>(null);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const uri = `spotify:${new URL(url).pathname.split('/').filter(Boolean).join(':')}`;
  const episode = (playback?.playingURI || uri).startsWith('spotify:episode:');
  const capturing = recorder.state.kind === 'recording' || recorder.state.kind === 'paused';
  const wasCapturing = useRef(capturing);
  useEffect(() => {
    if (wasCapturing.current && !capturing) player.current?.pause();
    wasCapturing.current = capturing;
  }, [capturing]);
  useEffect(() => {
    let disposed = false;
    let instance: SpotifyController | null = null;
    const timeout = window.setTimeout(() => {
      if (!disposed) setError('Spotify is taking too long to load. Reload the player or open in Spotify.');
    }, 25000);
    void loadSpotifyApi().then(api => {
      if (disposed || !host.current) return;
      const mount = document.createElement('div');
      host.current.appendChild(mount);
      api.createController(mount, { uri, width: '100%', height: 352 }, controller => {
        if (disposed) { controller.destroy(); return; }
        instance = controller;
        player.current = controller;
        controller.addListener('ready', () => {
          if (disposed) return;
          window.clearTimeout(timeout); setReady(true); setError('');
        });
        controller.addListener('playback_update', ({ data }) => {
          if (!disposed) setPlayback(data);
        });
      });
    }).catch(reason => {
      if (!disposed) { window.clearTimeout(timeout); setError(String(reason instanceof Error ? reason.message : reason)); }
    });
    return () => {
      disposed = true; window.clearTimeout(timeout); player.current = null;
      instance?.destroy();
    };
  }, [uri]);
  // A checkpoint belongs to one episode, even when the embed advances within a show.
  useEffect(() => { setCheckpoint(null); }, [playback?.playingURI]);
  const pending = recorder.state.kind === 'requesting' || recorder.state.kind === 'uploading';
  const playAndRecord = async () => {
    const target = player.current;
    if (capturing) { recorder.stop(); target?.pause(); return; }
    if (!ready || !target || !recorder.canStart || pending) return;
    target.pause();
    if (episode && checkpoint !== null) target.seek(checkpoint);
    if (await recorder.start()) {
      if (player.current === target) target.resume();
    }
  };
  return <div className="spotify-practice">
    <div className="spotify-player-host" ref={host} />
    {error && <p className="youtube-error" role="alert">{error}</p>}
    <div className="media-actions" role="group" aria-label="Spotify practice controls">
      <button className="btn" disabled={!ready} onClick={() => player.current?.resume()}>Play</button>
      <button className="btn" disabled={!ready} onClick={() => player.current?.pause()}>Pause</button>
      {episode && <>
        {[-5, -1, 1, 5].map(seconds => <button className="btn" key={seconds} disabled={!ready || !playback}
          onClick={() => player.current?.seek(spotifySeekTarget(playback!.position, playback!.duration, seconds))}>
          {seconds < 0 ? 'Back' : 'Forward'} {Math.abs(seconds)}s
        </button>)}
        <button className="btn" disabled={!ready || !playback} onClick={() => {
          if (checkpoint !== null) player.current?.seek(checkpoint);
          else setCheckpoint(spotifySeekTarget(playback!.position, playback!.duration, 0));
        }}>{checkpoint === null ? 'Set checkpoint' : `Jump to ${checkpoint}s`}</button>
        {checkpoint !== null && <button className="btn" onClick={() => setCheckpoint(null)}>Clear checkpoint</button>}
      </>}
      <button className="btn primary" disabled={!capturing && (!ready || !recorder.canStart || pending)}
        onClick={() => void playAndRecord()}>{capturing ? 'Stop recording' : pending ? 'Preparing recording…' : 'Play and record'}</button>
    </div>
    <p className="media-hint">Spotify may require a click inside its player before playback starts, and may offer only a preview. Seeking and checkpoints are available for podcast episodes; playback speed uses Spotify’s own controls where available.</p>
  </div>;
}
