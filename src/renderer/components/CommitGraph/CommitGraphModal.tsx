import React from 'react';
import { X, GitBranch } from 'lucide-react';
import { CommitGraphView } from './CommitGraphView';
import { Modal, useModalClose } from '../ui/Modal';

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
}

function CommitGraphBody({
  projectPath,
  projectName,
  gitRemote,
  taskBranches,
  onSelectTask,
}: CommitGraphBodyProps) {
  const close = useModalClose();

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <GitBranch size={14} className="text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
          <span className="text-[13px] font-medium text-foreground truncate">Commit History</span>
          <span className="text-[11px] text-muted-foreground truncate">{projectName}</span>
        </div>

        <button
          onClick={close}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <CommitGraphView
        projectPath={projectPath}
        gitRemote={gitRemote}
        taskBranches={taskBranches}
        onSelectTask={onSelectTask}
      />
    </>
  );
}
