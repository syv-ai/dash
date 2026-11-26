import { TOAST_CHANNEL, type ToastPayload } from '@shared/toast';
import { broadcast } from './broadcast';

/** Main's one way to raise a toast: the renderer shows it with `toast.fromMain`. */
export function toastRenderer(payload: ToastPayload): void {
  broadcast(TOAST_CHANNEL, payload);
}
