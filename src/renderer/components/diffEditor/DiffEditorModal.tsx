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
  /** Initial view. Defaults to working tree at HEAD/index. Pass `{kind:'commit', hash:'HEAD'}`
   *  to open at the latest commit (the editor resolves the sentinel once commits load). */
  initialView?: EditorView;
  activeTaskId: string | null;
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
