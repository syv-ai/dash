import React, { useEffect, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { Button } from '../ui/Button';
import { CheckboxField } from '../ui/CheckboxField';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { useModalClose } from '../ui/Modal';

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

export function DeleteTaskModal(props: DeleteTaskModalProps) {
  return (
    <Dialog size="sm" onClose={props.onClose}>
      <DeleteTaskBody task={props.task} onConfirm={props.onConfirm} />
    </Dialog>
  );
}

interface DeleteTaskBodyProps {
  task: Task;
  onConfirm: (options?: RemoveWorktreeOptions) => Promise<void>;
}

function DeleteTaskBody({ task, onConfirm }: DeleteTaskBodyProps) {
  const close = useModalClose();
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
    <>
      <DialogHeader title="Delete task?" description={task.name} closeDisabled={isDeleting} />
      <DialogBody className="gap-4">
        {task.useWorktree ? (
          <div className="grid gap-2.5">
            <CheckboxField
              checked={deleteWorktreeDir}
              onChange={setDeleteWorktreeDir}
              label={
                <>
                  Delete the worktree folder{' '}
                  <span className="text-ink-3">{task.path.split(/[\\/]/).slice(-3).join('/')}</span>
                </>
              }
            />
            <CheckboxField
              checked={deleteLocalBranch}
              onChange={setDeleteLocalBranch}
              label={
                <>
                  Delete the local branch <span className="text-ink-3">{task.branch}</span>
                </>
              }
            />
            {hasRemoteBranch && (
              <CheckboxField
                checked={deleteRemoteBranch}
                onChange={setDeleteRemoteBranch}
                label={
                  <>
                    Delete the remote branch{' '}
                    <span className="text-ink-3">origin/{task.branch}</span>
                  </>
                }
              />
            )}
          </div>
        ) : (
          <p className="type-body">The task and its session are removed from Dash.</p>
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
