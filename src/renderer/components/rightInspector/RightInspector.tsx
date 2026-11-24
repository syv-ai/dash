import { lazy, Suspense, useCallback, useEffect, useState, type RefObject } from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { MessageSquareCode, Minus, Plus } from 'lucide-react';
import { FileChangesPanel } from '../changes/FileChangesPanel';
import { CommitPopover } from '../changes/CommitPopover';
import { useCommitRun } from '../changes/useCommitRun';
import { ShellDrawerWrapper } from '../terminal/ShellDrawerWrapper';
import { PortsDrawerWrapper } from './PortsDrawerWrapper';
import { UsageBlock } from './UsageBlock';
import { IconButton } from '../ui/IconButton';
import { Segmented } from '../ui/Segmented';
import { CountBadge } from '../ui/CountBadge';
import type { PanelImperativeHandle } from '../ui/Resizable';
import { useGit, type DiffFileTarget } from '../../stores/gitStore';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { formatBinding, matchesBinding, type KeyBinding } from '../../keybindings';
import { needsAttention } from '../../../shared/diffComments';
import type { ContextUsage, RateLimits, Task } from '../../../shared/types';

const DiffEditor = lazy(() =>
  import('../diffEditor/DiffEditor').then((m) => ({ default: m.DiffEditor })),
);

type FileScope = 'changes' | 'all';

interface RightInspectorProps {
  task: Task;
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
  /** The diff open in the sidebar, or null for the changes list. */
  diff: DiffFileTarget | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onViewDiff: (filePath: string, staged: boolean) => void;
  /** Open the diff editor where "Open in editor" lands (see editorOpening). */
  onOpenEditor: () => void;
  onCloseDiff: () => void;
  onCommitFinished: () => void;
  onShowCommitGraph: () => void;
  shellDrawerRef: RefObject<PanelImperativeHandle | null>;
  onTuiActiveChange: (active: boolean, canvasPx?: number) => void;
}

/** A tooltip label with its shortcut, e.g. "Stage all  ⇧⌘A". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The task sidebar: the changes (or, with a file open, the diff editor) with
 * their header, the task's terminals below, and its usage at the foot.
 */
export function RightInspector({
  task,
  rateLimits,
  contextUsage,
  diff,
  terminalTheme,
  isDark,
  onViewDiff,
  onOpenEditor,
  onCloseDiff,
  onCommitFinished,
  onShowCommitGraph,
  shellDrawerRef,
  onTuiActiveChange,
}: RightInspectorProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const gitLoading = useGit((s) => s.gitLoading);
  const stageAll = useGit((s) => s.stageAll);
  const unstageAll = useGit((s) => s.unstageAll);
  const keybindings = useSettings((s) => s.keybindings);
  const shellDrawerCollapsed = useSettings((s) => s.shellDrawerCollapsed);
  const setShellDrawerCollapsed = useSettings((s) => s.setShellDrawerCollapsed);
  const portsDrawerCollapsed = useSettings((s) => s.portsDrawerCollapsed);
  const setPortsDrawerCollapsed = useSettings((s) => s.setPortsDrawerCollapsed);
  const shellDrawerAnimating = useUi((s) => s.shellDrawerAnimating);
  const setShellDrawerAnimating = useUi((s) => s.setShellDrawerAnimating);
  const run = useCommitRun(task.path, onCommitFinished);

  // The task's notes to send and PR comments to submit, across every view.
  const commentCount = useCommentsStore((s) => {
    if (s.taskId !== task.id) return 0;
    let n = 0;
    for (const list of Object.values(s.byFile)) for (const c of list) if (needsAttention(c)) n++;
    return n;
  });
  useEffect(() => {
    if (useCommentsStore.getState().taskId !== task.id) {
      void useCommentsStore.getState().loadForTask(task.id);
    }
  }, [task.id]);

  // Which files the tree lists. The list view always shows the changes;
  // "All files" opens the editor, whose tree can list the whole repo.
  const [scope, setScope] = useState<FileScope>('changes');
  const shownScope: FileScope = diff ? scope : 'changes';
  const selectScope = (next: FileScope) => {
    setScope(next);
    if (next === 'all' && !diff) onOpenEditor();
  };
  const viewDiff = useCallback(
    (filePath: string, staged: boolean) => {
      setScope('changes');
      onViewDiff(filePath, staged);
    },
    [onViewDiff],
  );

  const files = gitStatus?.files ?? [];
  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.length - stagedCount;
  // Collapse/expand animates; the flag drops once the 200ms ease is over.
  const settleShellDrawer = (collapsed: boolean) => {
    setShellDrawerCollapsed(collapsed);
    setTimeout(() => setShellDrawerAnimating(false), 200);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-ground pt-2 pr-2">
      <div className="min-h-0 flex-1">
        <ShellDrawerWrapper
          taskId={task.id}
          cwd={task.path}
          collapsed={shellDrawerCollapsed}
          label={task.useWorktree ? 'Worktree' : 'Terminal'}
          terminalBg={terminalTheme.background}
          panelRef={shellDrawerRef}
          animating={shellDrawerAnimating}
          onAnimate={() => setShellDrawerAnimating(true)}
          onCollapse={() => settleShellDrawer(true)}
          onExpand={() => settleShellDrawer(false)}
          onTuiActiveChange={onTuiActiveChange}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-0.5 pl-0.5">
              {/* Takes the slack, and gives it up first: the labels truncate
                  before the actions are pushed out of a narrow sidebar. */}
              <div className="min-w-0 flex-1">
                <Segmented
                  aria-label="Files"
                  size="sm"
                  fullWidth={false}
                  value={shownScope}
                  onChange={selectScope}
                  options={[
                    { value: 'changes', label: 'Changes', count: files.length || undefined },
                    { value: 'all', label: 'All files' },
                  ]}
                />
              </div>
              {unstagedCount > 0 && (
                <IconButton
                  size="sm"
                  title={withShortcut('Stage all', keybindings.stageAll)}
                  onClick={() => void stageAll()}
                >
                  <Plus size={14} strokeWidth={1.8} />
                </IconButton>
              )}
              {stagedCount > 0 && (
                <IconButton
                  size="sm"
                  title={withShortcut('Unstage all', keybindings.unstageAll)}
                  onClick={() => void unstageAll()}
                >
                  <Minus size={14} strokeWidth={1.8} />
                </IconButton>
              )}
              {/* The editor holds the comments; "All files" opens it otherwise. */}
              {commentCount > 0 && (
                <>
                  <IconButton
                    size="sm"
                    title={`Comments: ${commentCount} to send`}
                    onClick={onOpenEditor}
                  >
                    <MessageSquareCode size={14} strokeWidth={1.8} />
                  </IconButton>
                  <CountBadge count={commentCount} className="-ml-1" />
                </>
              )}
              {stagedCount > 0 && (
                <div className="ml-1">
                  <CommitPopover run={run} />
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <PortsDrawerWrapper
                taskId={task.id}
                collapsed={portsDrawerCollapsed}
                onCollapse={() => setPortsDrawerCollapsed(true)}
                onExpand={() => setPortsDrawerCollapsed(false)}
              >
                {diff ? (
                  <InlineDiff
                    diff={diff}
                    task={task}
                    changedOnly={shownScope === 'changes'}
                    terminalTheme={terminalTheme}
                    isDark={isDark}
                    closeBinding={keybindings.closeDiff}
                    onClose={onCloseDiff}
                  />
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <FileChangesPanel
                      key={task.id}
                      loading={gitLoading}
                      run={run}
                      onViewDiff={viewDiff}
                      onShowCommitGraph={onShowCommitGraph}
                    />
                  </div>
                )}
              </PortsDrawerWrapper>
            </div>
          </div>
        </ShellDrawerWrapper>
      </div>
      <UsageBlock task={task} contextUsage={contextUsage} rateLimits={rateLimits} />
    </div>
  );
}

/** The diff editor on its own sheet, closed by its × or Escape. Keyed on the
 *  target, since the editor reads its opening file and view only on mount. */
function InlineDiff({
  diff,
  task,
  changedOnly,
  terminalTheme,
  isDark,
  closeBinding,
  onClose,
}: {
  diff: DiffFileTarget;
  task: Task;
  changedOnly: boolean;
  terminalTheme: XtermTheme;
  isDark: boolean;
  closeBinding: KeyBinding | undefined;
  onClose: () => void;
}) {
  return (
    <div
      className="h-full overflow-hidden rounded-xl border border-line bg-well"
      onKeyDown={(e) => {
        // Escape from inside the editor (Monaco's textarea skips the global
        // shortcuts). Monaco claims the keys it uses, e.g. to close its find
        // widget, by preventing their default.
        if (!closeBinding || e.defaultPrevented) return;
        if (!matchesBinding(e.nativeEvent, closeBinding)) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <Suspense fallback={null}>
        <DiffEditor
          key={`${diff.filePath}\0${diff.staged}\0${JSON.stringify(diff.initialView ?? null)}`}
          cwd={diff.cwd}
          initialFilePath={diff.filePath}
          initialStaged={diff.staged}
          initialView={diff.initialView}
          activeTaskId={task.id}
          projectId={task.projectId}
          terminalTheme={terminalTheme}
          isDark={isDark}
          changedOnly={changedOnly}
          inline
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}
