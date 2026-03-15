import React, { useEffect, useMemo, useState } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import type { Project, Task } from '../../shared/types';
import { CircleCheck } from './ui/CircleCheck';

const PROTECTED_BRANCHES = new Set([
  'main',
  'master',
  'develop',
  'development',
  'staging',
  'production',
  'release',
  'deploy',
]);

function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch.toLowerCase());
}

export interface DeleteProjectOptions {
  deleteWorktreeDirs: boolean;
  deleteLocalBranches: boolean;
  deleteRemoteBranches: boolean;
}

interface DeleteProjectModalProps {
  project: Project;
  tasks: Task[];
  onClose: () => void;
  onConfirm: (options: DeleteProjectOptions) => Promise<void>;
}

export function DeleteProjectModal({
  project,
  tasks,
  onClose,
  onConfirm,
}: DeleteProjectModalProps) {
  const [deleteWorktreeDirs, setDeleteWorktreeDirs] = useState(true);
  const [deleteLocalBranches, setDeleteLocalBranches] = useState(true);
  const [deleteRemoteBranches, setDeleteRemoteBranches] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const worktreeTasks = useMemo(() => tasks.filter((t) => t.useWorktree), [tasks]);

  const branchTasks = useMemo(
    () => tasks.filter((t) => t.branch && !isProtectedBranch(t.branch)),
    [tasks],
  );

  const candidateRemoteTasks = useMemo(
    () => branchTasks.filter((t) => t.branchCreatedByDash),
    [branchTasks],
  );

  const [remoteBranchTaskIds, setRemoteBranchTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (candidateRemoteTasks.length === 0) return;
    let cancelled = false;
    Promise.all(
      candidateRemoteTasks.map(
        (t) =>
          window.electronAPI
            .gitRemoteBranchExists?.({ cwd: t.path, branch: t.branch })
            ?.then((res) => (res.success && res.data ? t.id : null))
            .catch(() => null) ?? Promise.resolve(null),
      ),
    ).then((ids) => {
      if (!cancelled) {
        setRemoteBranchTaskIds(new Set(ids.filter((id): id is string => id !== null)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [candidateRemoteTasks]);

  const remoteBranchTasks = useMemo(
    () => candidateRemoteTasks.filter((t) => remoteBranchTaskIds.has(t.id)),
    [candidateRemoteTasks, remoteBranchTaskIds],
  );

  const hasCleanupOptions =
    worktreeTasks.length > 0 || branchTasks.length > 0 || remoteBranchTasks.length > 0;

  async function handleConfirm() {
    setIsDeleting(true);
    try {
      await onConfirm({ deleteWorktreeDirs, deleteLocalBranches, deleteRemoteBranches });
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
          <h2 className="text-[14px] font-semibold text-foreground">Delete Project</h2>
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
            Are you sure you want to delete this project and all its tasks?
          </p>
          <p className="text-[13px] font-medium text-foreground mb-4 truncate">{project.name}</p>

          {hasCleanupOptions && (
            <div className="flex flex-col gap-2.5 mb-4">
              {worktreeTasks.length > 0 && (
                <CircleCheck
                  checked={deleteWorktreeDirs}
                  onChange={setDeleteWorktreeDirs}
                  label={
                    <>
                      Delete worktree directories{' '}
                      <span className="text-muted-foreground/50 font-normal">
                        ({worktreeTasks.length} worktree
                        {worktreeTasks.length !== 1 ? 's' : ''})
                      </span>
                    </>
                  }
                />
              )}
              {branchTasks.length > 0 && (
                <CircleCheck
                  checked={deleteLocalBranches}
                  onChange={setDeleteLocalBranches}
                  label={
                    <>
                      Delete local branches{' '}
                      <span className="text-muted-foreground/50 font-normal">
                        ({branchTasks.length} branch
                        {branchTasks.length !== 1 ? 'es' : ''})
                      </span>
                    </>
                  }
                />
              )}
              {remoteBranchTasks.length > 0 && (
                <CircleCheck
                  checked={deleteRemoteBranches}
                  onChange={setDeleteRemoteBranches}
                  label={
                    <>
                      Delete remote branches{' '}
                      <span className="text-muted-foreground/50 font-normal">
                        ({remoteBranchTasks.length} remote branch
                        {remoteBranchTasks.length !== 1 ? 'es' : ''})
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
