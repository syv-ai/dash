import type { ITheme as XtermTheme } from '@xterm/xterm';
import { Modal } from '../ui/Modal';
import type { EditorView } from './types';
import { DiffEditor } from './DiffEditor';

export interface DiffEditorModalProps {
  cwd: string;
  /** File the user clicked, or '' to let the editor pick the first file in the view. */
  initialFilePath: string;
  /** Whether the clicked file was the staged version. Used only when initialView is omitted. */
  initialStaged: boolean;
  /** Initial view. When set it overrides the per-repo stored view; when omitted the
   *  editor restores the stored view, falling back to the working tree at HEAD/index. */
  initialView?: EditorView;
  activeTaskId: string | null;
  /** `cwd` is a folder of its own (Claude's memory folder), not the active
   *  task's worktree: the task's git status and comments don't belong to it. */
  standalone?: boolean;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onClose: () => void;
}

export function DiffEditorModal(props: DiffEditorModalProps) {
  return (
    <Modal onClose={props.onClose} size="w-[92vw] h-[88vh]">
      <DiffEditor {...props} />
    </Modal>
  );
}

export default DiffEditorModal;
