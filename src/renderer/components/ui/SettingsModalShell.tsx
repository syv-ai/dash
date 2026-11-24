import React from 'react';
import { X } from 'lucide-react';
import { Modal, useModalClose } from './Modal';
import { IconButton } from './IconButton';

interface SettingsModalShellProps {
  title: string;
  onClose: () => void;
  /** Tailwind sizing override. Defaults to the standard settings card. */
  size?: string;
  children: React.ReactNode;
}

/**
 * Standard settings-modal layout: titled header with close X + scrollable body.
 * Used by ProjectSettingsModal and TaskSettingsModal so they stay visually
 * aligned; new settings modals should reuse this rather than re-implementing
 * the header chrome.
 */
export function SettingsModalShell({
  title,
  onClose,
  size = 'w-[460px] max-h-[80vh]',
  children,
}: SettingsModalShellProps) {
  return (
    <Modal onClose={onClose} size={size}>
      <SettingsModalShellBody title={title}>{children}</SettingsModalShellBody>
    </Modal>
  );
}

function SettingsModalShellBody({ title, children }: { title: string; children: React.ReactNode }) {
  const close = useModalClose();
  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between pl-5 pr-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <IconButton title="Close" onClick={close}>
          <X size={14} strokeWidth={1.8} />
        </IconButton>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-1">{children}</div>
    </>
  );
}
