export type PracticeAction = 'set-checkpoint' | 'jump-checkpoint' | 'toggle-speed' | 'slower' | 'faster';
export const PRACTICE_ACTIONS: readonly PracticeAction[] = ['set-checkpoint', 'jump-checkpoint', 'toggle-speed', 'slower', 'faster'];

export function practiceShortcut(event: KeyboardEvent): PracticeAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;
  if (event.code === 'KeyW') return event.repeat ? null : event.shiftKey ? 'set-checkpoint' : 'jump-checkpoint';
  if (event.shiftKey) return null;
  if (event.code === 'KeyS') return event.repeat ? null : 'toggle-speed';
  return event.code === 'KeyA' ? 'slower' : event.code === 'KeyD' ? 'faster' : null;
}

export function isEditing(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input:not([type="range"]):not([type="button"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}
