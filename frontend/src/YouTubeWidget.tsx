import { useState, type FormEvent } from 'react';
import { parseYouTubeUrl, type YouTubeVideo } from './youtube';
import { YouTubePlayer } from './YouTubePlayer';

import type { RecordingController } from "./Recorder";

export function YouTubeWidget({ recorder, active }: { recorder: RecordingController; active: boolean }) {
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [error, setError] = useState('');
  const [loadId, setLoadId] = useState(0);

  const load = (event: FormEvent) => {
    event.preventDefault();
    const next = parseYouTubeUrl(url);
    if (!next) {
      setError('Paste a valid YouTube video URL (watch, share, Shorts, or live link).');
      return;
    }
    setError('');
    setVideo(next);
    setLoadId((id) => id + 1);
  };

  return (
    <section className="youtube-widget" aria-label="YouTube shadowing">
      <div className="youtube-panel">
        <form className="youtube-form" onSubmit={load}>
          <label className="youtube-label" htmlFor="youtube-url">Video URL</label>
          <input id="youtube-url" type="text" inputMode="url" value={url}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-invalid={!!error} aria-describedby={error ? 'youtube-error' : undefined}
            onChange={(event) => { setUrl(event.target.value); setError(''); }} />
          <button className="btn primary" type="submit" disabled={!url.trim()}>Load video</button>
        </form>
        {error && <p id="youtube-error" className="youtube-error" role="alert">{error}</p>}
        {video && <YouTubePlayer key={loadId} video={video} recorder={recorder} active={active} />}
      </div>
    </section>
  );
}
