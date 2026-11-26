import React, { useState } from 'react';
import { FolderGit2, Loader2, AlertCircle, Check } from 'lucide-react';
import type { WorktreeMigrationProject, WorktreeMigrationResult } from '../../../shared/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Code } from '../ui/Code';
import { DetailItem, DetailList } from '../ui/DetailList';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { useModalClose } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Checkbox';
import { CheckboxField } from '../ui/CheckboxField';

/** localStorage flag for "Don't ask again"; the plan is re-offered every launch otherwise. */
export const WORKTREE_MIGRATION_DISMISSED_KEY = 'dash.worktreeMigration.dismissed';

export function isWorktreeMigrationDismissed(): boolean {
  try {
    return window.localStorage.getItem(WORKTREE_MIGRATION_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setWorktreeMigrationDismissed(): void {
  try {
    window.localStorage.setItem(WORKTREE_MIGRATION_DISMISSED_KEY, '1');
  } catch {
    // localStorage unavailable — the dialog simply shows again next launch.
  }
}

interface WorktreeMigrationModalProps {
  plan: WorktreeMigrationProject[];
  onClose: () => void;
  /** Called after every project ran, with the per-project outcomes. */
  onMigrated: (results: WorktreeMigrationResult[]) => Promise<void>;
}

/**
 * Launch dialog offering to move task worktrees from the pre-0.16
 * `<parent>/worktrees/` location into each project's `.claude/worktrees/`,
 * the layout Claude Code assumes. "Later" re-asks next launch; "Don't ask
 * again" leaves those tasks where they are for good (they keep working).
 */
export function WorktreeMigrationModal(props: WorktreeMigrationModalProps) {
  return (
    <Dialog size="lg" onClose={props.onClose}>
      <WorktreeMigrationBody plan={props.plan} onMigrated={props.onMigrated} />
    </Dialog>
  );
}

type Phase = { kind: 'confirm' } | { kind: 'running'; done: number } | { kind: 'done' };

function WorktreeMigrationBody({ plan, onMigrated }: Omit<WorktreeMigrationModalProps, 'onClose'>) {
  const close = useModalClose();
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const [dontAsk, setDontAsk] = useState(false);
  const [removeStale, setRemoveStale] = useState(true);
  const [results, setResults] = useState<WorktreeMigrationResult[]>([]);
  // Projects ticked for this run; the rest are offered again next launch.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(plan.map((p) => p.projectId)),
  );

  const taskCount = plan.reduce((n, p) => n + p.tasks.length, 0);
  const chosen = plan.filter((p) => selected.has(p.projectId));
  const chosenTaskCount = chosen.reduce((n, p) => n + p.tasks.length, 0);
  const movedCount = results.reduce((n, r) => n + r.moved.length, 0);
  const removedCount = results.reduce((n, r) => n + r.removed.length, 0);
  const failures = results.flatMap((r) => r.failed);
  const staleCount = chosen.reduce((n, p) => n + p.tasks.filter((t) => t.stale).length, 0);
  const movableCount = chosenTaskCount - staleCount;

  function toggleProject(projectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function handleLater() {
    if (dontAsk) setWorktreeMigrationDismissed();
    close();
  }

  async function handleMove() {
    setPhase({ kind: 'running', done: 0 });
    const collected: WorktreeMigrationResult[] = [];
    for (const project of chosen) {
      const resp = await window.electronAPI.worktreeMigrate({
        projectId: project.projectId,
        removeStale,
      });
      collected.push(
        resp.success && resp.data
          ? resp.data
          : {
              projectId: project.projectId,
              moved: [],
              removed: [],
              failed: project.tasks.map((t) => ({
                taskId: t.taskId,
                taskName: t.taskName,
                error: resp.error ?? 'Migration failed',
              })),
            },
      );
      setResults([...collected]);
      setPhase({ kind: 'running', done: collected.length });
    }
    await onMigrated(collected);
    setPhase({ kind: 'done' });
  }

  const busy = phase.kind === 'running';

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <DialogHeader title="Move task worktrees" closeDisabled={busy} />
      <DialogBody>
        {phase.kind !== 'done' ? (
          <>
            <p className="type-body">
              Dash now keeps each task&rsquo;s worktree inside its project, at{' '}
              <Code>.claude/worktrees/</Code>, where Claude Code expects it.{' '}
              {count(taskCount, 'worktree')} in {count(plan.length, 'project')} still{' '}
              {taskCount === 1 ? 'lives' : 'live'} at the old location. Moving keeps every branch,
              file and setting; running task terminals restart afterwards. Untick a project to leave
              it for a later launch.
            </p>

            <div className="grid gap-3">
              {plan.map((project) => (
                <div
                  key={project.projectId}
                  className={
                    selected.has(project.projectId)
                      ? 'grid gap-2 rounded-lg border border-line p-3'
                      : 'grid gap-2 rounded-lg border border-line p-3 opacity-50'
                  }
                >
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 select-none">
                    <Checkbox
                      checked={selected.has(project.projectId)}
                      disabled={busy}
                      onChange={() => toggleProject(project.projectId)}
                    />
                    <FolderGit2 size={14} strokeWidth={1.8} className="text-icon" />
                    <span className="type-heading truncate">{project.projectName}</span>
                    <span className="type-caption ml-auto shrink-0">
                      {count(project.tasks.length, 'task')}
                    </span>
                  </label>
                  <DetailList>
                    <DetailItem label="From" title={project.legacyDir}>
                      {project.legacyDir}
                    </DetailItem>
                    <DetailItem label="To" title={project.targetDir}>
                      {project.targetDir}
                    </DetailItem>
                  </DetailList>
                  <ul className="grid gap-1">
                    {project.tasks.map((t) => (
                      <li key={t.taskId} className="flex min-w-0 items-center gap-2">
                        <span className="type-body truncate">{t.taskName}</span>
                        <span className="type-caption truncate">{t.branch}</span>
                        {t.archived && <Badge size="sm">Archived</Badge>}
                        {t.stale && (
                          <Badge
                            size="sm"
                            title="The folder is no longer a git worktree; only leftover files remain"
                          >
                            Not a worktree
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <Notice
              icon={
                failures.length === 0 ? (
                  <Check size={14} strokeWidth={1.8} />
                ) : (
                  <AlertCircle size={14} strokeWidth={1.8} />
                )
              }
            >
              Moved {movedCount} of {count(movableCount, 'worktree')}
              {removedCount > 0 ? `, removed ${count(removedCount, 'stale task')}` : ''}
              {chosen.length < plan.length
                ? ` (${count(plan.length - chosen.length, 'project')} left for next launch)`
                : ''}
              .
              {failures.length > 0 &&
                ' The tasks below stay where they were and keep working; fix the cause and Dash offers the move again next launch.'}
            </Notice>
            {failures.length > 0 && (
              <ul className="grid gap-1.5">
                {failures.map((f) => (
                  <li key={f.taskId} className="grid gap-1 rounded-lg border border-line px-3 py-2">
                    <span className="type-body">{f.taskName}</span>
                    <pre className="font-mono text-xs break-words whitespace-pre-wrap text-ink-2">
                      {f.error}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter
        divided
        start={
          phase.kind === 'confirm' && (
            <div className="grid gap-1.5">
              {staleCount > 0 && (
                <CheckboxField
                  checked={removeStale}
                  onChange={setRemoveStale}
                  label={`Remove the ${count(staleCount, 'task')} whose folder is no longer a worktree`}
                />
              )}
              <CheckboxField checked={dontAsk} onChange={setDontAsk} label="Don't ask again" />
            </div>
          )
        }
      >
        {phase.kind === 'done' ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={handleLater} disabled={busy}>
              Later
            </Button>
            <Button onClick={() => void handleMove()} disabled={busy || chosen.length === 0}>
              {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
              {busy
                ? `Moving ${phase.kind === 'running' ? phase.done : 0}/${chosen.length}…`
                : chosen.length < plan.length
                  ? `Move ${chosen.length} of ${plan.length}`
                  : 'Move now'}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
