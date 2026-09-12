export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  destroy(): void;
}
interface PlayerEvent { target: YouTubePlayer; data: number }
interface YouTubeApi {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    playerVars: { start: number; playsinline: number; origin: string };
    events: {
      onReady: (event: PlayerEvent) => void;
      onPlaybackRateChange: (event: PlayerEvent) => void;
      onStateChange: (event: PlayerEvent) => void;
      onError: (event: PlayerEvent) => void;
    };
  }) => YouTubePlayer;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<YouTubeApi> | null = null;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onYouTubeIframeAPIReady;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previous;
      script.onerror = null;
    };
    const fail = () => {
      cleanup();
      script.remove();
      loading = null;
      reject(new Error('Could not connect to YouTube. Check your connection and load the video again.'));
    };
    const timeout = window.setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = () => {
      cleanup();
      if (window.YT?.Player) resolve(window.YT);
      else { loading = null; reject(new Error('YouTube player API is unavailable. Load the video again.')); }
      previous?.();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}
