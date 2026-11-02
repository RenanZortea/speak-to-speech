"""Site-scoped presentation and best-effort HTML media controls."""
import json
import math
from urllib.parse import urlsplit

MEDIA_HOSTS = {"youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"}


def validate_media_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port
            or parsed.hostname not in MEDIA_HOSTS):
        raise ValueError("Use an HTTPS YouTube address.")
    return url


CLEAN_CSS = {
    "youtube": """
      ytd-watch-flexy #secondary, ytd-watch-flexy #comments,
      ytd-watch-flexy #related, ytd-watch-flexy #below #actions { display:none !important; }
    """,
    "instagram": """
      article section:has(svg[aria-label='Like']),
      article section:has(svg[aria-label='Unlike']),
      article section:has(svg[aria-label='Comment']),
      article section:has(svg[aria-label='Share']),
      article form, article ul { display:none !important; }
    """,
    "spotify": """
      [data-testid='right-sidebar'], [data-testid='buddy-feed'],
      [data-testid='browse-page'] { display:none !important; }
    """,
}


def clean_script(enabled):
    # Keep the original media element in place, so the site's player retains ownership.
    # Re-running this is safe after SPA navigation or delayed video insertion.
    return r"""(() => {
      const id = 'speaktospeech-clean-view';
      const previous = window.__stsVideoFocus;
      const restore = () => {
        if (previous) {
          previous.nodes.forEach(node => node.removeAttribute('data-sts-focus-path'));
          previous.video.removeAttribute('data-sts-focus-video');
          previous.video.controls = previous.controls;
          window.__stsVideoFocus = null;
        }
        document.getElementById(id)?.remove();
      };
      if (!ENABLED) { restore(); return; }
      const host = location.hostname, path = location.pathname;
      const instagram = ['instagram.com','www.instagram.com'].includes(host) && /^\/(p|reel|reels|tv)\//.test(path);
      const youtube = ['youtube.com','www.youtube.com','music.youtube.com','m.youtube.com'].includes(host)
          && (path === '/watch' || path.startsWith('/shorts/'));
      const videos = (instagram || youtube) ? [...document.querySelectorAll('video')]
        .filter(video => video.readyState > 0 && video.getBoundingClientRect().width > 0)
        .sort((a,b) => Number(!b.paused) - Number(!a.paused)
          || b.getBoundingClientRect().width * b.getBoundingClientRect().height
             - a.getBoundingClientRect().width * a.getBoundingClientRect().height) : [];
      const video = videos[0];
      if (previous && previous.video === video && previous.url === location.href
          && document.getElementById(id)) return;
      restore();
      let css = instagram ? CSS.instagram : youtube ? CSS.youtube : '';
      if (host === 'open.spotify.com' && !path.startsWith('/login')) css = CSS.spotify;
      if (video) {
        const nodes = [];
        for (let parent = video.parentElement; parent; parent = parent.parentElement) {
          parent.setAttribute('data-sts-focus-path', ''); nodes.push(parent);
          if (parent === document.body) break;
        }
        window.__stsVideoFocus = {video, nodes, controls: video.controls, url: location.href};
        video.setAttribute('data-sts-focus-video', ''); video.controls = true;
        css += `
          html, body { margin:0 !important; padding:0 !important; background:#101114 !important; overflow:hidden !important; }
          [data-sts-focus-path] > :not([data-sts-focus-path]):not([data-sts-focus-video]) { display:none !important; }
          [data-sts-focus-path] { display:block !important; position:static !important; transform:none !important;
            filter:none !important; perspective:none !important; contain:none !important; overflow:visible !important;
            margin:0 !important; padding:0 !important; max-width:none !important; max-height:none !important; }
          video[data-sts-focus-video] { position:fixed !important; inset:0 !important; width:100vw !important;
            height:100vh !important; max-width:none !important; max-height:none !important; margin:0 !important;
            object-fit:contain !important; z-index:2147483646 !important; display:block !important; }
        `;
      }
      if (css && document.documentElement) {
        const style = document.createElement('style'); style.id = id;
        style.textContent = css; document.documentElement.appendChild(style);
      }
    })()""".replace('ENABLED', json.dumps(enabled)).replace('CSS', json.dumps(CLEAN_CSS))


def media_script(action, value=0):
    if action not in {"status", "play", "pause", "seek", "seek_to", "rate"}:
        raise ValueError("Unknown playback action")
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Playback value must be finite")
    if action == 'rate' and not 0.25 <= value <= 2:
        raise ValueError("Playback speed must be between 0.25 and 2")
    script = r"""(() => {
      const host = location.hostname;
      if (!HOSTS.includes(host)) return {available:false};
      const media = [...document.querySelectorAll('video,audio')]
        .filter(m => m.readyState > 0)
        .sort((a,b) => Number(!b.paused)-Number(!a.paused)
          || b.getBoundingClientRect().width*b.getBoundingClientRect().height
             - a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
      if (!media) {
        const error = document.querySelector('.yt-playability-error-supported-renderers, ytd-player-error-message-renderer, #error-screen')?.textContent?.trim();
        return {available:false, ...(error ? {error:error.slice(0, 500)} : {})};
      }
      const action = ACTION, value = VALUE;
      if (action === 'play') media.play().catch(() => {});
      if (action === 'pause') media.pause();
      if (action === 'seek') media.currentTime = Math.max(0, Math.min(
        Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + value));
      if (action === 'seek_to') media.currentTime = Math.max(0, Math.min(
        Number.isFinite(media.duration) ? media.duration : Infinity, value));
      if (action === 'rate') media.playbackRate = value;
      return {available:true, paused:media.paused, time:media.currentTime,
        duration:Number.isFinite(media.duration) ? media.duration : 0, rate:media.playbackRate};
    })()""".replace('HOSTS', json.dumps(sorted(MEDIA_HOSTS))).replace('ACTION', json.dumps(action)).replace('VALUE', json.dumps(value))

    return f"JSON.stringify({script})"


def focused_script():
    """Keep YouTube's player controls, captions and skip UI inside a locked surface."""
    # Undo the older video-only focus: it hid the player's sibling control layers.
    return clean_script(False) + r""";
    (() => {
      if (!document.documentElement) return;
      const allowed = '.ytp-chrome-bottom, .ytp-settings-menu, .ytp-caption-window-container, '
        + '.ytp-ad-skip-button-container, .ytp-ad-skip-button-slot, .ytp-skip-ad-button, '
        + '.ytp-ad-skip-button, .ytp-ad-skip-button-modern';
      const blocked = 'a, .ytp-next-button, .ytp-prev-button, .ytp-miniplayer-button, '
        + '.ytp-size-button, .ytp-fullscreen-button, .ytp-remote-button, '
        + '.ytp-autonav-toggle-button, .ytp-autonav-toggle, .ytp-youtube-button';
      const video = document.querySelector('#movie_player video, .html5-video-player video, video');
      const root = video?.closest('#movie_player, .html5-video-player')
        || document.querySelector('#movie_player, .html5-video-player') || video;
      const old = window.__stsPlayerFocus;
      const nodes = [];
      for (let node = root?.parentElement; node; node = node.parentElement) {
        nodes.push(node);
        if (node === document.body) break;
      }
      // YouTube moves the same player from its bootstrap shell into the watch page.
      if (old?.root !== root || old?.video !== video || old?.nodes.length !== nodes.length
          || nodes.some((node, index) => old?.nodes[index] !== node)) {
        old?.nodes.forEach(node => node.removeAttribute('data-sts-player-path'));
        old?.root.removeAttribute('data-sts-player');
        old?.video?.removeAttribute('data-sts-focus-video');
        if (root) {
          nodes.forEach(node => node.setAttribute('data-sts-player-path', ''));
          root.setAttribute('data-sts-player', '');
          window.__stsPlayerFocus = {root, video, nodes};
        } else window.__stsPlayerFocus = null;
      }
      if (video) { video.controls = false; video.setAttribute('data-sts-focus-video', ''); }
      const id = 'sts-focused-surface';
      if (!document.getElementById(id)) {
        const style = document.createElement('style'); style.id = id;
        const show = allowed.split(', ').flatMap(selector => [
          '[data-sts-player] ' + selector, '[data-sts-player] ' + selector + ' *'
        ]).join(', ');
        const hide = blocked.split(', ').flatMap(selector => [
          '[data-sts-player] ' + selector, '[data-sts-player] ' + selector + ' *'
        ]).join(', ');
        style.textContent = `
          html, body { background:#101114 !important; margin:0 !important; overflow:hidden !important; }
          body * { visibility:hidden !important; pointer-events:none !important; }
          [data-sts-player-path] > :not([data-sts-player-path]):not([data-sts-player]) { display:none !important; }
          [data-sts-player-path] { transform:none !important; filter:none !important; perspective:none !important;
            contain:none !important; overflow:visible !important; }
          [data-sts-player] { position:fixed !important; inset:0 !important; width:100vw !important;
            height:100vh !important; max-width:none !important; max-height:none !important;
            margin:0 !important; z-index:2147483646 !important; background:#101114 !important; }
          video[data-sts-focus-video] { visibility:visible !important; position:fixed !important;
            inset:0 !important; width:100vw !important; height:100vh !important;
            object-fit:contain !important; margin:0 !important; pointer-events:auto !important; cursor:pointer !important; }
          ${show} { visibility:visible !important; pointer-events:auto !important; }
          [data-sts-player] .ytp-chrome-bottom { opacity:1 !important; bottom:0 !important;
            left:12px !important; width:calc(100% - 24px) !important; z-index:60 !important; }
          [data-sts-player] .ytp-settings-menu { z-index:80 !important; }
          [data-sts-player] .ytp-caption-window-container { z-index:50 !important; pointer-events:none !important; }
          ${hide} { display:none !important; visibility:hidden !important; pointer-events:none !important; }
        `;
        document.documentElement.appendChild(style);
      }
      if (!window.__stsPracticeKeysInstalled) {
        window.__stsPracticeKeysInstalled = true;
        window.__stsPracticeKeys = [];
        window.addEventListener('keydown', event => {
          const target = event.target instanceof Element ? event.target : null;
          if (!event.isTrusted || event.ctrlKey || event.altKey || event.metaKey || event.isComposing
              || target?.closest('input:not([type=range]):not([type=button]), textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]')) return;
          let action = null;
          if (event.code === 'KeyW' && !event.repeat) action = event.shiftKey ? 'set-checkpoint' : 'jump-checkpoint';
          if (!event.shiftKey) {
            if (event.code === 'KeyS' && !event.repeat) action = 'toggle-speed';
            if (event.code === 'KeyA') action = 'slower';
            if (event.code === 'KeyD') action = 'faster';
          }
          if (!action) return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (window.__stsPracticeKeys.length < 32)
            window.__stsPracticeKeys.push({action, time:performance.now()});
        }, true);
      }
      if (!window.__stsPlayerControlsLocked) {
        window.__stsPlayerControlsLocked = true;
        for (const type of ['click', 'auxclick', 'dblclick', 'contextmenu', 'keydown', 'submit']) {
          window.addEventListener(type, event => {
            const target = event.target instanceof Element ? event.target : event.target?.parentElement;
            const inPlayer = target?.closest('[data-sts-player]');
            // Handle only the video itself; consume the click so YouTube's
            // own bubbling handler cannot toggle it a second time.
            if (type === 'click' && inPlayer && target.matches('video[data-sts-focus-video]')) {
              event.preventDefault(); event.stopImmediatePropagation();
              if (event.button === 0 && event.detail <= 1 && target.readyState > 0) {
                if (target.paused) target.play().catch(() => {});
                else target.pause();
              }
              return;
            }
            const control = target?.closest(allowed);
            const safeKey = type !== 'keydown' || (!event.altKey && !event.ctrlKey && !event.metaKey
              && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Escape','Tab','Home','End','PageUp','PageDown'].includes(event.key));
            if (inPlayer && control && !target.closest(blocked) && safeKey
                && (type === 'click' || type === 'keydown')) return;
            event.preventDefault(); event.stopImmediatePropagation();
          }, true);
        }
      }
    })();
    """
