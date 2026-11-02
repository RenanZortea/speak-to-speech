import { describe, expect, it } from 'vitest';
import { parseMediaUrl, youtubeErrorMessage } from './media';

describe('media links', () => {
  it('preserves YouTube timestamps and removes unrelated query parameters', () => {
    expect(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=2m&si=tracking')).toEqual({
      provider: 'YouTube', video: { id: 'dQw4w9WgXcQ', start: 120 },
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s',
    });
  });
  it.each(['p', 'reel', 'reels', 'tv'])('accepts Instagram %s links without tracking', kind => {
    const result = parseMediaUrl(`https://www.instagram.com/${kind}/Abc_123-/?igsh=tracking`);
    expect(result).toEqual({ provider: 'Instagram',
      url: `https://www.instagram.com/${kind === 'reels' ? 'reel' : kind}/Abc_123-/`,
      embedUrl: `https://www.instagram.com/${kind === 'reels' ? 'reel' : kind}/Abc_123-/embed/` });
  });
  it.each(['track', 'album', 'playlist', 'episode', 'show', 'artist'])('accepts Spotify %s, locale, and embed links', kind => {
    for (const prefix of ['', 'intl-pt/', 'embed/']) {
      const path = `${kind}/0123456789abcdefghijkl`;
      expect(parseMediaUrl(`https://open.spotify.com/${prefix}${path}?si=tracking`)).toEqual({
        provider: 'Spotify', url: `https://open.spotify.com/${path}`, embedUrl: `https://open.spotify.com/embed/${path}`,
      });
    }
  });
  it.each(['https://instagram.com.evil.test/reel/abc/', 'https://open.spotify.com@evil.test/track/0123456789abcdefghijkl',
    'javascript:alert(1)', 'https://www.instagram.com/accounts/login/', 'https://instagram.com/username/',
    'https://open.spotify.com/track/short', 'https://open.spotify.com/track/0123456789abcdefghijkl/extra',
    'https://instagram.com:8080/reel/abc/', 'https://instagram.com/reel/abc%22/', 'https://spotify.link/abc', ''])
    ('rejects unsupported or unsafe input: %s', url => expect(parseMediaUrl(url)).toBeNull());
});

describe('YouTube failures', () => {
  it('distinguishes an owner restriction from configuration, missing content, and browser failures', () => {
    expect(youtubeErrorMessage(101)).toContain('owner');
    expect(youtubeErrorMessage(150)).toBe(youtubeErrorMessage(101));
    expect(youtubeErrorMessage(153)).toContain('configuration');
    expect(youtubeErrorMessage(100)).toContain('private');
    expect(youtubeErrorMessage(5)).toContain('browser');
    expect(youtubeErrorMessage(999)).toContain('999');
    expect(youtubeErrorMessage(153)).not.toContain('owner');
  });
});
