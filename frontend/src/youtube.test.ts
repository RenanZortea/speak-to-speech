import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl } from './youtube';

describe('parseYouTubeUrl', () => {
  const id = 'dQw4w9WgXcQ';
  it.each([
    `https://www.youtube.com/watch?v=${id}&list=example`,
    `youtu.be/${id}?si=tracking`,
    `https://m.youtube.com/shorts/${id}`,
    `https://youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ])('accepts supported video links: %s', (url) => {
    expect(parseYouTubeUrl(url)).toEqual({ id, start: 0 });
  });
  it.each([
    ['?t=90', 90], ['?t=1h2m3s', 3723], ['?start=42', 42],
    ['#t=2m', 120], ['?t=-5', 0], ['?t=garbage', 0],
  ])('handles timestamps: %s', (suffix, start) => {
    expect(parseYouTubeUrl(`https://youtu.be/${id}${suffix}`)).toEqual({ id, start });
  });
  it.each([
    '', 'not a URL', 'javascript:alert(1)',
    `https://youtube.com.evil.test/watch?v=${id}`,
    `https://youtube.com@evil.test/watch?v=${id}`,
    `https://evil.test/${id}`, 'https://youtube.com/playlist?list=abc',
    'https://youtube.com/watch?v=short', `https://youtu.be/${id}/extra`,
  ])('rejects invalid or unrelated links: %s', (url) => {
    expect(parseYouTubeUrl(url)).toBeNull();
  });
});
