import React, { useState, useCallback, useEffect } from 'react';
import { X, GitBranch } from 'lucide-react';
import { CommitGraphView } from './CommitGraphView';

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

export function CommitGraphModal({
  projectPath,
  projectName,
  gitRemote,
  taskBranches,
  onClose,
  onSelectTask,
}: CommitGraphModalProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleClose();
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center modal-backdrop ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleBackdropClick}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <div
        className={`bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[94vw] max-w-6xl h-[88vh] flex flex-col overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <GitBranch
              size={14}
              className="text-muted-foreground flex-shrink-0"
              strokeWidth={1.8}
            />
            <span className="text-[13px] font-medium text-foreground truncate">
              Commit History
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              {projectName}
            </span>
          </div>

          <button
            onClick={handleClose}
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
      </div>
    </div>
  );
}
