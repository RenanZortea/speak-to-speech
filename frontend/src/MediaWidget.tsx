import { useState, type FormEvent } from 'react';
import { parseYouTubeUrl } from './youtube';
import { api } from './api';
import { NativeYouTubePlayer } from './NativeYouTubePlayer';
import { LogIn } from 'lucide-react';
import type { RecordingController } from './Recorder';


export function MediaWidget({ recorder, active }: { recorder: RecordingController; active: boolean }) {
  const desktop = typeof window !== 'undefined' && !!window.pywebview?.embeddedMedia;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [loadId, setLoadId] = useState(0);
  const recordingBusy = ['requesting', 'recording', 'paused', 'uploading'].includes(recorder.state.kind);
  const open = async (address: string) => {
    if (recordingBusy || opening) return;
    const video = parseYouTubeUrl(address);
    if (!video) { setError('Paste a YouTube video link (watch, share, Shorts, or live).'); return; }
    const target = `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s`;
    setOpening(true); setError('');
    try {
      if (desktop) await api.openMediaBrowser(target);
      else {
        const tab = window.open('about:blank', '_blank');
        if (!tab) throw new Error('Allow pop-ups to open YouTube in your browser.');
        tab.opener = null;
        tab.location.href = target;
      }
      setOpened(true); setLoadId(id => id + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open YouTube. Try again.');
    } finally { setOpening(false); }
  };
  const signIn = async () => {
    if (opening || recordingBusy) return;
    setOpening(true); setError('');
    try { await api.mediaSignIn(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open sign-in.'); }
    finally { setOpening(false); }
  };
  const load = (event: FormEvent) => { event.preventDefault(); void open(url); };
  return <section className="youtube-widget" aria-label="YouTube practice">
    <div className="youtube-panel">
      <form className="youtube-form" onSubmit={load}>
        <label className="youtube-label" htmlFor="media-url">YouTube URL</label>
        <input id="media-url" type="text" inputMode="url" value={url}
          placeholder="Paste a YouTube video link"
          aria-invalid={!!error} aria-describedby={error ? 'media-error' : undefined}
          onChange={event => { setUrl(event.target.value); setError(''); }} />
        <button className="btn primary" type="submit" disabled={!url.trim() || recordingBusy || opening}>{opening ? 'Opening…' : 'Load video'}</button>
        {desktop && <button className="btn youtube-sign-in" type="button" disabled={opening || recordingBusy}
          onClick={() => void signIn()}><LogIn size={14} />Sign in</button>}
      </form>
      {error && <p id="media-error" className="youtube-error" role="alert">{error}</p>}
      <p className="media-hint">{desktop
        ? 'Load a video to practice. Sign in to use your YouTube account.'
        : 'The in-app YouTube browser is available in the desktop app. These buttons open YouTube in your browser; use the Source panel to record.'}</p>
      {opened && desktop && <NativeYouTubePlayer key={loadId} recorder={recorder} active={active} />}
    </div>
  </section>;
}
