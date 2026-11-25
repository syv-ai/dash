/**
 * What a mouse press asks for: `primary` selects and drags; `context` opens a
 * context menu (the secondary button, or a Control-click on a Mac, which the
 * system turns into one); anything else is neither.
 */
export type PressKind = 'primary' | 'context' | 'other';

export function pressKind(e: { button: number; ctrlKey: boolean }, mac: boolean): PressKind {
  if (e.button === 2 || (mac && e.button === 0 && e.ctrlKey)) return 'context';
  return e.button === 0 ? 'primary' : 'other';
}

/** This machine is a Mac (where Control-click is a right-click). */
export const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
