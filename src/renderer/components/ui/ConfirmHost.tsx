import { create } from 'zustand';
import { ConfirmModal } from './ConfirmModal';

/*
 * An in-app confirm, awaited like `window.confirm` without its native dialog:
 * `if (!(await confirm({ ... }))) return;`. One `<ConfirmHost />`, mounted
 * after the app's other modals, shows it over them.
 */

export interface ConfirmOptions {
  /** A short question above the message; omit when the message is one. */
  title?: string;
  message: string;
  confirmLabel: string;
  /** A confirm that throws work away (Discard). */
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

const useConfirmStore = create<{ pending: Pending | null }>(() => ({ pending: null }));
let nextId = 0;

/** Ask; resolves true on confirm, false on cancel. A newer ask cancels an
 *  unanswered one. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().pending?.resolve(false);
    useConfirmStore.setState({ pending: { ...options, id: ++nextId, resolve } });
  });
}

/** Renders the pending confirm, if any. */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  if (!pending) return null;
  const settle = (confirmed: boolean) => {
    if (useConfirmStore.getState().pending?.id === pending.id) {
      useConfirmStore.setState({ pending: null });
    }
    pending.resolve(confirmed);
  };
  return (
    <ConfirmModal
      key={pending.id}
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      destructive={pending.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
