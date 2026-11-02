import { parseYouTubeUrl, type YouTubeVideo } from './youtube';

export type MediaSource =
  | { provider: 'YouTube'; url: string; video: YouTubeVideo }
  | { provider: 'Instagram' | 'Spotify'; url: string; embedUrl: string };

export function parseMediaUrl(input: string): MediaSource | null {
  const video = parseYouTubeUrl(input);
  if (video) return { provider: 'YouTube', video, url: `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s` };
  try {
    const value = input.trim();
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname)
      && parts.length === 2 && ['p', 'reel', 'reels', 'tv'].includes(parts[0]) && /^[\w-]+$/.test(parts[1])) {
      const kind = parts[0] === 'reels' ? 'reel' : parts[0];
      const canonical = `https://www.instagram.com/${kind}/${parts[1]}/`;
      return { provider: 'Instagram', url: canonical, embedUrl: `${canonical}embed/` };
    }
    if (url.hostname === 'open.spotify.com') {
      if (/^intl-[a-z-]+$/i.test(parts[0] ?? '')) parts.shift();
      if (parts[0] === 'embed') parts.shift();
      if (parts.length === 2 && ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(parts[0])
        && /^[a-zA-Z0-9]{22}$/.test(parts[1])) {
        return { provider: 'Spotify', url: `https://open.spotify.com/${parts.join('/')}`,
          embedUrl: `https://open.spotify.com/embed/${parts.join('/')}` };
      }
    }
  } catch { /* Invalid URL. */ }
  return null;
}

export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 101: case 150: return 'The owner does not allow this video to play in other apps. Open it in YouTube and use the Source panel to record.';
    case 153: return 'YouTube could not identify this app (error 153). Open in YouTube to continue; this is a player configuration issue.';
    case 100: return 'This video is unavailable, private, or has been removed. Try another link or check it on YouTube.';
    case 2: return 'YouTube rejected this video link (error 2). Check the link and try again.';
    case 5: return 'This video cannot play in the app’s browser (error 5). Try opening it in YouTube.';
    default: return `YouTube could not play this video (error ${code}). Retry or open it in YouTube.`;
  }
}

/** Website navigation deliberately preserves paths and queries, unlike embed URLs. */
export function parseYouTubeBrowserUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /[\\\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
