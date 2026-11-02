export interface SpotifyPlayback {
  playingURI: string;
  isPaused: boolean;
  isBuffering: boolean;
  duration: number;
  position: number;
}
export interface SpotifyController {
  resume(): void;
  pause(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(event: 'ready', callback: () => void): void;
  addListener(event: 'playback_update', callback: (event: { data: SpotifyPlayback }) => void): void;
}
export interface SpotifyApi {
  createController(element: HTMLElement, options: { uri: string; width: string; height: number }, callback: (controller: SpotifyController) => void): void;
}
declare global {
  interface Window { onSpotifyIframeApiReady?: (api: SpotifyApi) => void }
}
let api: SpotifyApi | null = null;
let loading: Promise<SpotifyApi> | null = null;

export function loadSpotifyApi(): Promise<SpotifyApi> {
  if (api) return Promise.resolve(api);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onSpotifyIframeApiReady;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.onerror = null;
      window.onSpotifyIframeApiReady = previous;
    };
    const fail = () => {
      cleanup(); script.remove(); loading = null;
      reject(new Error('Could not connect to Spotify. Reload the player or open in Spotify.'));
    };
    const timeout = window.setTimeout(fail, 15000);
    window.onSpotifyIframeApiReady = value => {
      api = value; cleanup(); resolve(value); previous?.(value);
    };
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

export function spotifySeekTarget(positionMs: number, durationMs: number, offsetSeconds: number): number {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs / 1000) : 0;
  const end = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : Infinity;
  return Math.floor(Math.max(0, Math.min(end, position + offsetSeconds)));
}
