import React from 'react';
import { X } from 'lucide-react';
import { Modal, useModalClose } from './Modal';

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
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40 flex-shrink-0">
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        <button
          onClick={close}
          className="p-1.5 rounded-lg hover:bg-accent text-foreground/50 hover:text-foreground transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="p-5 space-y-5 overflow-y-auto flex-1">{children}</div>
    </>
  );
}
