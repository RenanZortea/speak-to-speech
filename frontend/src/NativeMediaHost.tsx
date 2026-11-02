import { useEffect, useRef } from 'react';
import { api } from './api';

/** Reserve React layout space for the native Qt child view. */
export function NativeMediaHost({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let last = '';
    let disposed = false;
    const report = () => {
      frame = 0;
      const element = host.current;
      if (!element || disposed) return;
      const rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (style.overflowX !== 'visible') { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (style.overflowY !== 'visible') { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      const modal = !!document.querySelector('.modal-overlay, dialog[open], .toolbar-menu[open]');
      const bounds = {
        visible: active && !modal && rect.width > 0 && right > left && bottom > top,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        clip: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      };
      const encoded = JSON.stringify(bounds);
      if (encoded !== last) {
        last = encoded;
        void api.setMediaBounds(bounds).catch(() => { last = ''; });
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report); };
    const resize = new ResizeObserver(schedule);
    if (host.current) resize.observe(host.current);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      void api.setMediaBounds({ visible: false }).catch(() => {});
    };
  }, [active]);
  return <div ref={host} className="native-media-host" aria-label="In-app media browser" />;
}
