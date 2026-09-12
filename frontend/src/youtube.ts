export interface YouTubeVideo {
  id: string;
  start: number;
}

export function parseYouTubeUrl(input: string): YouTubeVideo | null {
  try {
    const value = input.trim();
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be' && parts.length === 1) id = parts[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
    } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)
      && parts.length === 2 && parts[0] === 'embed') id = parts[1];
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const timestamp = url.searchParams.get('t') ?? url.searchParams.get('start')
      ?? new URLSearchParams(url.hash.slice(1)).get('t') ?? '0';
    let start = 0;
    if (/^\d+$/.test(timestamp)) start = Number(timestamp);
    else {
      const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(timestamp);
      if (match) start = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    }
    return { id, start: Number.isSafeInteger(start) ? start : 0 };
  } catch {
    return null;
  }
}
