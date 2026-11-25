import { X } from 'lucide-react';
import type { SupervisorSession } from '../../../shared/types';
import { Modal, useModalClose } from '../ui/Modal';
import { TerminalPane } from '../terminal/TerminalPane';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { FOREIGN_SESSION_PTY_PREFIX } from '../../terminal/ptyExitFallback';

interface SessionAttachModalProps {
  session: SupervisorSession & { id: string };
  onClose: () => void;
}

/**
 * `claude attach` into a session that belongs to no task, in a modal so the
 * main pane's active task stays untouched. Closing kills only the attach
 * client; the session keeps running under Claude Code's supervisor. Adopting
 * the session as a task gives it a permanent pane.
 */
export function SessionAttachModal({ session, onClose }: SessionAttachModalProps) {
  const ptyId = `${FOREIGN_SESSION_PTY_PREFIX}${session.id}`;
  return (
    <Modal
      onClose={() => {
        void sessionRegistry.dispose(ptyId);
        onClose();
      }}
      size="w-[min(1100px,92vw)] h-[min(760px,88vh)]"
    >
      <SessionAttachBody session={session} ptyId={ptyId} />
    </Modal>
  );
}

function SessionAttachBody({
  session,
  ptyId,
}: {
  session: SupervisorSession & { id: string };
  ptyId: string;
}) {
  const close = useModalClose();
  const label = session.name || session.id;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-5 h-12 border-b border-border/40 shrink-0">
        <div className="min-w-0 flex items-baseline gap-2">
          <h2 className="type-title truncate">{label}</h2>
          <span className="text-xs text-muted-fade-60 truncate">
            {session.id} · {session.cwd}
          </span>
        </div>
        <button
          onClick={close}
          title="Detach and close"
          className="p-1.5 rounded-lg hover:bg-accent text-icon hover:text-foreground transition-all duration-150 shrink-0"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-background">
        <TerminalPane id={ptyId} cwd={session.cwd} />
      </div>
    </div>
  );
}
