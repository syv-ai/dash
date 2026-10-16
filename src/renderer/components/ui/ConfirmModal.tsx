import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

/** A warning confirmation with Cancel / confirm buttons, rendered as a nested
 *  modal over whatever dialog asked (Extensions scope changes, task settings). */
export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} size="w-[420px]">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--warn)/0.15)] text-[hsl(var(--warn))]">
            <AlertTriangle size={18} strokeWidth={1.8} />
          </div>
          <div className="pt-0.5 text-[12.5px] leading-relaxed text-fg-fade-80">{message}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
