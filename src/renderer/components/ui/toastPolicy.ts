/**
 * The rules behind every toast, with no React and no sonner: how long each
 * kind stays, which toasts collapse into one, the "Copied X" text, how main's
 * payload maps to a toast, and the focus gate offers wait behind.
 * `ui/toast.ts` is the only caller.
 */
import type { ToastKind, ToastLink, ToastPayload } from '@shared/toast';

export type ToastVariant = ToastKind | 'copied' | 'offer' | 'progress';

/** The one owner of toast durations; no call site passes its own. */
export const TOAST_DURATION: Record<ToastVariant, number> = {
  info: 4000,
  success: 3000,
  copied: 1800,
  warning: 6000,
  error: 8000,
  offer: 20_000,
  progress: Infinity,
};

/** A sticky offer holds something the person would lose with it (their text
 *  in a write conflict, a notice no watch took): it stays until they act on it
 *  or close it. */
export const STICKY_OFFER_DURATION = Infinity;

/** For a condition that lasts (duplicate task directories, Q8): long enough
 *  to read and act on, but still transient. */
export const LASTING_TOAST_DURATION = 20_000;

/** Same id → one toast, updated in place, its countdown restarted. */
export function toastId(kind: ToastVariant, title: string, key?: string): string {
  return key ?? `${kind}:${title}`;
}

/** Longer text is noise in a toast; the title says what was copied. */
const COPIED_DESCRIPTION_MAX = 80;

export function copiedContent(what: string, text: string): { title: string; description?: string } {
  const title = `Copied ${what}`;
  return text.length <= COPIED_DESCRIPTION_MAX ? { title, description: text } : { title };
}

const KINDS: readonly ToastKind[] = ['info', 'success', 'warning', 'error'];

export interface MainToast {
  kind: ToastKind;
  title: string;
  description?: string;
  id: string;
  duration: number;
  link?: ToastLink;
}

/** Main's payload as a toast. An unknown kind (a newer main beside an older
 *  renderer) shows as info rather than not at all. */
export function fromPayload(p: ToastPayload): MainToast {
  const kind = KINDS.includes(p.kind) ? p.kind : 'info';
  return {
    kind,
    title: p.title,
    description: p.description,
    id: toastId(kind, p.title, p.key),
    duration: TOAST_DURATION[kind],
    link: p.action,
  };
}

/** Holds work until the window has focus. Sonner pauses on `document.hidden`
 *  but not on blur, so an offer raised while Dash sits visible behind another
 *  app would expire unseen. Dedupe is the toast id's job, not the gate's. */
export function createFocusGate(isFocused: () => boolean) {
  let queue: Array<() => void> = [];
  return {
    run(fn: () => void): void {
      if (isFocused()) fn();
      else queue.push(fn);
    },
    flush(): void {
      const pending = queue;
      queue = [];
      for (const fn of pending) fn();
    },
    size(): number {
      return queue.length;
    },
  };
}
