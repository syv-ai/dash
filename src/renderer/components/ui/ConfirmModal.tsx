import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

/** A warning confirmation with Cancel / confirm buttons, rendered as a nested
 *  modal over whatever dialog asked (e.g. task settings),
 *  or on its own (an agent outside Dash asking for access). */
export function ConfirmModal({
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} size="w-105">
      <div className="flex flex-col gap-4 p-5">
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
          <Button variant="primary" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
