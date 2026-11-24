import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

/** A warning confirmation with Cancel / confirm buttons, rendered as a nested
 *  modal over whatever dialog asked (e.g. task settings),
 *  or on its own (an agent outside Dash asking for access). It takes focus,
 *  so Enter confirms and Escape cancels; `destructive` for a confirm that
 *  throws work away. */
export function ConfirmModal({
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => panelRef.current?.focus(), []);

  return (
    <Modal onClose={onCancel} size="w-105">
      {/* Focused on open, so keys stop reaching whatever asked (an editor
          beneath would take the Enter). A focused button handles its own. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex flex-col gap-4 p-5 outline-none"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
          e.preventDefault();
          onConfirm();
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-state-needs/12 text-state-needs">
            <AlertTriangle size={14} strokeWidth={1.8} />
          </div>
          <div className="pt-1.5 text-base text-ink">{message}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
