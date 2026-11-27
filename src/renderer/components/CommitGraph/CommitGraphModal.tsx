import React from 'react';
import { CommitGraphView } from './CommitGraphView';
import { DialogHeader } from '../ui/Dialog';
import { Modal } from '../ui/Modal';

export interface TaskBranchInfo {
  id: string;
  name: string;
  useWorktree: boolean;
}

interface CommitGraphModalProps {
  projectPath: string;
  projectName: string;
  gitRemote: string | null;
  taskBranches: Map<string, TaskBranchInfo>;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
  /** Select + scroll to this commit on open (e.g. from the blame card). */
  focusHash?: string | null;
}

export function CommitGraphModal(props: CommitGraphModalProps) {
  return (
    <Modal onClose={props.onClose} size="w-[94vw] max-w-6xl h-[88vh]">
      <CommitGraphBody
        projectPath={props.projectPath}
        projectName={props.projectName}
        gitRemote={props.gitRemote}
        taskBranches={props.taskBranches}
        onSelectTask={props.onSelectTask}
        focusHash={props.focusHash}
      />
    </Modal>
  );
}

interface CommitGraphBodyProps {
  projectPath: string;
  projectName: string;
  gitRemote: string | null;
  taskBranches: Map<string, TaskBranchInfo>;
  onSelectTask: (taskId: string) => void;
  focusHash?: string | null;
}

function CommitGraphBody({
  projectPath,
  projectName,
  gitRemote,
  taskBranches,
  onSelectTask,
  focusHash,
}: CommitGraphBodyProps) {
  return (
    <>
      <DialogHeader title="Commit history" description={projectName} divided />

      {/* Content */}
      <CommitGraphView
        projectPath={projectPath}
        gitRemote={gitRemote}
        taskBranches={taskBranches}
        onSelectTask={onSelectTask}
        focusHash={focusHash}
      />
    </>
  );
}
