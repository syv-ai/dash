import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import type { Project, Task } from '../../../shared/types';
import { Button } from '../ui/Button';
import { CheckboxField } from '../ui/CheckboxField';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { useModalClose } from '../ui/Modal';

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

export function DeleteProjectModal(props: DeleteProjectModalProps) {
  return (
    <Dialog size="sm" onClose={props.onClose}>
      <DeleteProjectBody project={props.project} tasks={props.tasks} onConfirm={props.onConfirm} />
    </Dialog>
  );
}

interface DeleteProjectBodyProps {
  project: Project;
  tasks: Task[];
  onConfirm: (options: DeleteProjectOptions) => Promise<void>;
}

function DeleteProjectBody({ project, tasks, onConfirm }: DeleteProjectBodyProps) {
  const close = useModalClose();
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
    void Promise.all(
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

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <DialogHeader title="Delete project?" description={project.name} closeDisabled={isDeleting} />
      <DialogBody className="gap-4">
        <p className="type-body">The project and all its tasks are removed from Dash.</p>
        {hasCleanupOptions && (
          <div className="grid gap-2.5">
            {worktreeTasks.length > 0 && (
              <CheckboxField
                checked={deleteWorktreeDirs}
                onChange={setDeleteWorktreeDirs}
                label={
                  <>
                    Delete worktree folders{' '}
                    <span className="text-ink-3">
                      ({count(worktreeTasks.length, 'worktree', 'worktrees')})
                    </span>
                  </>
                }
              />
            )}
            {branchTasks.length > 0 && (
              <CheckboxField
                checked={deleteLocalBranches}
                onChange={setDeleteLocalBranches}
                label={
                  <>
                    Delete local branches{' '}
                    <span className="text-ink-3">
                      ({count(branchTasks.length, 'branch', 'branches')})
                    </span>
                  </>
                }
              />
            )}
            {remoteBranchTasks.length > 0 && (
              <CheckboxField
                checked={deleteRemoteBranches}
                onChange={setDeleteRemoteBranches}
                label={
                  <>
                    Delete remote branches{' '}
                    <span className="text-ink-3">
                      ({count(remoteBranchTasks.length, 'branch', 'branches')})
                    </span>
                  </>
                }
              />
            )}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={isDeleting}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void handleConfirm()} disabled={isDeleting}>
          {isDeleting ? (
            <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
          ) : (
            <Trash2 size={14} strokeWidth={1.8} />
          )}
          {isDeleting ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogFooter>
    </>
  );
}
