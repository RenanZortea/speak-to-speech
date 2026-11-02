import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spotifySeekTarget } from './spotifyPlayer';

describe('Spotify episode seeking', () => {
  it('converts milliseconds to whole seconds and clamps to episode bounds', () => {
    expect(spotifySeekTarget(12400, 60000, -5)).toBe(7);
    expect(spotifySeekTarget(1000, 60000, -5)).toBe(0);
    expect(spotifySeekTarget(59000, 60000, 5)).toBe(60);
    expect(spotifySeekTarget(12400, 60000, 0)).toBe(12);
  });
  it('handles unknown duration and invalid position', () => {
    expect(spotifySeekTarget(12000, 0, 5)).toBe(17);
    expect(spotifySeekTarget(NaN, Infinity, -1)).toBe(0);
  });
});

describe('Spotify API lifecycle', () => {
  let scripts: Array<{ src: string; onerror: null | (() => void); remove: ReturnType<typeof vi.fn> }>;
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); scripts = [];
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', {
      createElement: () => ({ src: '', onerror: null, remove: vi.fn() }),
      head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('shares an in-flight script and caches the API after readiness', async () => {
    const { loadSpotifyApi } = await import('./spotifyPlayer');
    const first = loadSpotifyApi();
    expect(loadSpotifyApi()).toBe(first);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://open.spotify.com/embed/iframe-api/v1');
    const api = { createController: vi.fn() };
    window.onSpotifyIframeApiReady!(api);
    await expect(first).resolves.toBe(api);
    await expect(loadSpotifyApi()).resolves.toBe(api);
    expect(vi.getTimerCount()).toBe(0);
    expect(scripts).toHaveLength(1);
  });
  it('cleans up after timeout and permits a new attempt', async () => {
    const { loadSpotifyApi } = await import('./spotifyPlayer');
    const first = loadSpotifyApi();
    const rejected = expect(first).rejects.toThrow('Could not connect');
    vi.advanceTimersByTime(15000);
    await rejected;
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    const retry = loadSpotifyApi();
    const api = { createController: vi.fn() };
    window.onSpotifyIframeApiReady!(api);
    await expect(retry).resolves.toBe(api);
    expect(scripts).toHaveLength(2);
  });
  it('reports network failure and restores the previous readiness callback', async () => {
    const previous = vi.fn();
    window.onSpotifyIframeApiReady = previous;
    const { loadSpotifyApi } = await import('./spotifyPlayer');
    const first = loadSpotifyApi();
    const rejected = expect(first).rejects.toThrow('Could not connect');
    scripts[0].onerror!();
    await rejected;
    expect(window.onSpotifyIframeApiReady).toBe(previous);
    expect(vi.getTimerCount()).toBe(0);
  });
});
