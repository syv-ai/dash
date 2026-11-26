/** The one main → renderer toast contract. Main raises toasts through
 *  `toastRenderer` (main/utils/toast.ts); the renderer shows them with
 *  `toast.fromMain` (renderer/components/ui/toast.ts). */
export const TOAST_CHANNEL = 'app:toast';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** A toast's one action when it comes from main: main can't send a callback,
 *  so the action is data the renderer knows how to run. */
export type ToastLink = { type: 'openUrl'; label: string; url: string };

export interface ToastPayload {
  kind: ToastKind;
  title: string;
  description?: string;
  /** Collapses repeats into one toast; defaults to kind + title. */
  key?: string;
  action?: ToastLink;
}
