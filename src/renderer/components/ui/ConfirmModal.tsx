import { useEffect, useRef } from 'react';
import { Button } from './Button';
import { Dialog, DialogFooter } from './Dialog';
import { useModalTitleId } from './Modal';

/** A confirmation with Cancel / confirm buttons, rendered as a nested
 *  dialog over whatever asked (e.g. task settings), or on its own (an agent
 *  outside Dash asking for access). It takes focus, so Enter confirms and
 *  Escape cancels; `destructive` for a confirm that throws work away (the
 *  button says so; no warning icon, colour is for agent state). */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  /** A short question above the message; omit when the message is one. */
  title?: string;
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
    <Dialog size="sm" role="alertdialog" onClose={onCancel}>
      {/* Focused on open, so keys stop reaching whatever asked (an editor
          beneath would take the Enter). A focused button handles its own. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="outline-none"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
          e.preventDefault();
          onConfirm();
        }}
      >
        <ConfirmText title={title} message={message} />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** The question and message; the title names the alertdialog, or the
 *  message does when there is no title. Inside the Modal, for its title id. */
function ConfirmText({ title, message }: { title?: string; message: string }) {
  const titleId = useModalTitleId();
  return (
    <div className="grid gap-1.5 px-5 pt-5 pb-2">
      {title && (
        <h2 id={titleId} className="type-title">
          {title}
        </h2>
      )}
      <p id={title ? undefined : titleId} className="type-body">
        {message}
      </p>
    </div>
  );
}
