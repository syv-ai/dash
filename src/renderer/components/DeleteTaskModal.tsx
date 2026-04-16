import React, { useEffect, useState } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import type { Task } from '../../shared/types';
import { CircleCheck } from './ui/CircleCheck';

interface RemoveWorktreeOptions {
  deleteWorktreeDir: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

interface DeleteTaskModalProps {
  task: Task;
  onClose: () => void;
  onConfirm: (options?: RemoveWorktreeOptions) => Promise<void>;
}

export function DeleteTaskModal({ task, onClose, onConfirm }: DeleteTaskModalProps) {
  const [deleteWorktreeDir, setDeleteWorktreeDir] = useState(true);
  const [deleteLocalBranch, setDeleteLocalBranch] = useState(true);
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasRemoteBranch, setHasRemoteBranch] = useState(false);

  useEffect(() => {
    if (task.useWorktree && task.branchCreatedByDash && task.branch) {
      window.electronAPI
        .gitRemoteBranchExists?.({ cwd: task.path, branch: task.branch })
        ?.then((res) => {
          if (res.success && res.data) {
            setHasRemoteBranch(true);
          }
        })
        .catch(() => {});
    }
  }, [task]);

  async function handleConfirm() {
    setIsDeleting(true);
    try {
      if (task.useWorktree) {
        await onConfirm({ deleteWorktreeDir, deleteLocalBranch, deleteRemoteBranch });
      } else {
        await onConfirm();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={isDeleting ? undefined : onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[420px] animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <h2 className="text-[14px] font-semibold text-foreground">Delete Task</h2>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5">
          <p className="text-[13px] text-muted-foreground mb-1">
            Are you sure you want to delete this task?
          </p>
          <p className="text-[13px] font-medium text-foreground mb-4 truncate">{task.name}</p>

          {task.useWorktree && (
            <div className="flex flex-col gap-2.5 mb-4">
              <CircleCheck
                checked={deleteWorktreeDir}
                onChange={setDeleteWorktreeDir}
                label={
                  <>
                    Delete worktree directory{' '}
                    <span className="text-muted-foreground/50 font-normal">
                      {task.path.split(/[\\/]/).slice(-3).join('/')}
                    </span>
                  </>
                }
              />
              <CircleCheck
                checked={deleteLocalBranch}
                onChange={setDeleteLocalBranch}
                label={
                  <>
                    Delete local branch{' '}
                    <span className="text-muted-foreground/50 font-normal">{task.branch}</span>
                  </>
                }
              />
              {hasRemoteBranch && (
                <CircleCheck
                  checked={deleteRemoteBranch}
                  onChange={setDeleteRemoteBranch}
                  label={
                    <>
                      Delete remote branch{' '}
                      <span className="text-muted-foreground/50 font-normal">
                        origin/{task.branch}
                      </span>
                    </>
                  }
                />
              )}
            </div>
          )}

          <div className="flex gap-2.5 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 rounded-full text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isDeleting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-destructive text-destructive-foreground hover:brightness-110 transition-all duration-150 disabled:opacity-70 disabled:pointer-events-none"
            >
              {isDeleting ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={13} strokeWidth={2} />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
