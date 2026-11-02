import { describe, expect, it } from 'vitest';
import { parseYouTubeBrowserUrl } from './media';

describe('YouTube website addresses', () => {
  it.each([
    ['youtube.com', 'https://youtube.com/'],
    ['www.youtube.com/results?search_query=learn+hebrew', 'https://www.youtube.com/results?search_query=learn+hebrew'],
    ['https://www.youtube.com/@channel/videos', 'https://www.youtube.com/@channel/videos'],
    ['https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/playlist?list=PL123'],
    ['https://youtu.be/abc?t=42', 'https://youtu.be/abc?t=42'],
    ['https://m.youtube.com/shorts/abc', 'https://m.youtube.com/shorts/abc'],
  ])('preserves browsing URL %s', (input, expected) => {
    expect(parseYouTubeBrowserUrl(input)).toBe(expected);
  });
  it.each(['', 'https://youtube.com.evil.test/', 'https://youtube.com@evil.test/',
    'https://user@youtube.com/', 'https://youtube.com:8080/', 'javascript:alert(1)',
    'http://youtube.com/', 'https://instagram.com/', 'https://open.spotify.com/',
    'https://youtube.com\\@evil.test/', 'youtube.com\n.evil.test'])('rejects %s', input => {
    expect(parseYouTubeBrowserUrl(input)).toBeNull();
  });
});
