import { useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { DiffEditor, type DiffEditorProps } from './DiffEditor';
import { mayCloseEditor } from './closeGuard';

/** The diff editor over everything, for a folder that isn't the active task's
 *  worktree (Claude's memory, opened from the memory modal). A task's own
 *  diffs open inline in the task sidebar instead. */
export function DiffEditorModal(props: DiffEditorProps) {
  const { cwd } = props;
  const canClose = useCallback(() => mayCloseEditor(cwd), [cwd]);
  return (
    <Modal onClose={props.onClose} canClose={canClose} size="w-[92vw] h-[88vh]">
      <DiffEditor {...props} />
    </Modal>
  );
}

export default DiffEditorModal;
