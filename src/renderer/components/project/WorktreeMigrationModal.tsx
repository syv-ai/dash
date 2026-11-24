import React, { useState } from 'react';
import { X, FolderGit2, Loader2, AlertCircle, Check } from 'lucide-react';
import type { WorktreeMigrationProject, WorktreeMigrationResult } from '../../../shared/types';
import { Modal, useModalClose } from '../ui/Modal';

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
    <Modal onClose={props.onClose} size="w-[560px] max-h-[80vh]">
      <WorktreeMigrationBody plan={props.plan} onMigrated={props.onMigrated} />
    </Modal>
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

  return (
    <>
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40 shrink-0">
        <h2 className="type-title">Move task worktrees</h2>
        <button
          onClick={close}
          disabled={busy}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-fade-50 hover:text-foreground transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="px-5 py-4 overflow-y-auto min-h-0 flex-1 space-y-4">
        {phase.kind !== 'done' ? (
          <>
            <p className="text-base text-muted-foreground leading-relaxed">
              Dash now keeps each task&apos;s worktree inside its project at{' '}
              <code className="px-1 py-0.5 rounded-md bg-accent/80 text-xs font-mono text-fg-fade-75">
                .claude/worktrees/
              </code>
              , where Claude Code expects it. {taskCount} worktree{taskCount === 1 ? '' : 's'} in{' '}
              {plan.length} project{plan.length === 1 ? '' : 's'} still{' '}
              {taskCount === 1 ? 'lives' : 'live'} at the old location. Moving keeps every branch,
              file and setting; running task terminals restart afterwards. Untick a project to leave
              it for a later launch.
            </p>

            <div className="space-y-3">
              {plan.map((project) => (
                <div
                  key={project.projectId}
                  className={`rounded-xl border border-border/40 p-3.5 transition-opacity ${
                    selected.has(project.projectId) ? '' : 'opacity-50'
                  }`}
                  style={{ background: 'hsl(var(--surface-2))' }}
                >
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selected.has(project.projectId)}
                      disabled={busy}
                      onChange={() => toggleProject(project.projectId)}
                      className="accent-primary"
                    />
                    <FolderGit2 size={13} strokeWidth={1.8} className="text-muted-foreground" />
                    <span className="text-base font-medium text-foreground truncate">
                      {project.projectName}
                    </span>
                    <span className="text-xs text-muted-fade-70 ml-auto shrink-0">
                      {project.tasks.length} task{project.tasks.length === 1 ? '' : 's'}
                    </span>
                  </label>
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs text-fg-fade-50">
                    <dt className="text-muted-fade-60 select-none">from</dt>
                    <dd className="break-all">{project.legacyDir}</dd>
                    <dt className="text-muted-fade-60 select-none">to</dt>
                    <dd className="break-all">{project.targetDir}</dd>
                  </dl>
                  <ul className="mt-2 space-y-1">
                    {project.tasks.map((t) => (
                      <li
                        key={t.taskId}
                        className="flex items-center gap-2 text-sm text-fg-fade-80 min-w-0"
                      >
                        <span className="truncate">{t.taskName}</span>
                        <span className="text-xs text-muted-fade-60 truncate">{t.branch}</span>
                        {t.archived && (
                          <span className="px-1.5 py-[1px] rounded-full bg-accent/80 text-xs text-muted-foreground shrink-0">
                            archived
                          </span>
                        )}
                        {t.stale && (
                          <span
                            className="px-1.5 py-[1px] rounded-full bg-[hsl(var(--git-modified))]/15 text-[hsl(var(--git-modified))] text-xs shrink-0"
                            title="The folder is no longer a git worktree; only leftover files remain"
                          >
                            not a worktree
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  failures.length === 0
                    ? 'bg-[hsl(var(--git-added)/0.12)] text-[hsl(var(--git-added))]'
                    : 'bg-[hsl(var(--git-modified)/0.12)] text-[hsl(var(--git-modified))]'
                }`}
              >
                {failures.length === 0 ? (
                  <Check size={14} strokeWidth={2} />
                ) : (
                  <AlertCircle size={14} strokeWidth={2} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-base font-medium text-foreground">
                  Moved {movedCount} of {movableCount} worktree
                  {movableCount === 1 ? '' : 's'}
                  {removedCount > 0
                    ? `, removed ${removedCount} stale task${removedCount === 1 ? '' : 's'}`
                    : ''}
                  {chosen.length < plan.length
                    ? ` (${plan.length - chosen.length} project${
                        plan.length - chosen.length === 1 ? '' : 's'
                      } left for next launch)`
                    : ''}
                </p>
                {failures.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    The tasks below stay at their old location and keep working. Fix the cause and
                    Dash will offer the move again next launch.
                  </p>
                )}
              </div>
            </div>
            {failures.length > 0 && (
              <ul className="space-y-1.5">
                {failures.map((f) => (
                  <li
                    key={f.taskId}
                    className="rounded-lg border border-border/40 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-foreground">{f.taskName}</span>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-fade-60">
                      {f.error}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-border/40 shrink-0 flex items-center gap-3">
        {phase.kind === 'confirm' && (
          <div className="flex flex-col gap-1.5">
            {staleCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeStale}
                  onChange={(e) => setRemoveStale(e.target.checked)}
                  className="accent-primary"
                />
                Remove the {staleCount} task{staleCount === 1 ? '' : 's'} whose folder is no longer
                a worktree
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
              <input
                type="checkbox"
                checked={dontAsk}
                onChange={(e) => setDontAsk(e.target.checked)}
                className="accent-primary"
              />
              Don&apos;t ask again
            </label>
          </div>
        )}
        <div className="flex gap-2.5 justify-end ml-auto">
          {phase.kind === 'done' ? (
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 rounded-full text-base font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleLater}
                disabled={busy}
                className="px-4 py-2 rounded-full text-base text-muted-fade-60 hover:text-foreground hover:bg-accent/60 transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => void handleMove()}
                disabled={busy || chosen.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-base font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150 disabled:opacity-70 disabled:pointer-events-none"
              >
                {busy ? (
                  <>
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    Moving {phase.kind === 'running' ? phase.done : 0}/{chosen.length}…
                  </>
                ) : chosen.length < plan.length ? (
                  `Move ${chosen.length} of ${plan.length}`
                ) : (
                  'Move now'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
