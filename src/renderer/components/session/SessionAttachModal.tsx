import type { SupervisorSession } from '../../../shared/types';
import { DialogHeader } from '../ui/Dialog';
import { Modal } from '../ui/Modal';
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
  const label = session.name || session.id;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DialogHeader
        title={label}
        hint="Closing detaches; the session keeps running."
        description={`${session.id} · ${session.cwd}`}
        divided
      />
      <div className="min-h-0 flex-1 bg-ground">
        <TerminalPane id={ptyId} cwd={session.cwd} />
      </div>
    </div>
  );
}
