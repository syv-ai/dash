import { useMemo, useState } from 'react';
import { EyeOff, FileDiff, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '../ui/Checkbox';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { FileTree } from '../fileTree/FileTree';
import { subtreeChanges, type ItemRow } from '../fileTree/model';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import { CommitRunView } from './CommitRunView';
import { DiscardFolderConfirm } from './DiscardFolderConfirm';
import { SyncStatus, type SyncLinks } from './SyncStatus';
import { changeSections, changeSelection, fileActions, folderActions } from './changeSections';
import type { CommitRun } from './useCommitRun';
import type { CommitRunState } from './commitRunReducer';
import { useGit } from '../../stores/gitStore';

interface FileChangesPanelProps {
  cwd: string;
  loading: boolean;
  /** The commit in flight (or just finished): shown instead of the files. */
  run: CommitRun;
  /** Open a change's diff: staged against HEAD, or the working tree's. A
   *  click previews it (`preview`), ⌥-click opens it beside (`toSide`). */
  onOpenChange: (path: string, staged: boolean, opts?: OpenOptions) => void;
  /** The editor's file and view: its row reads as current. */
  activePath: string | null;
  view: EditorView;
  canOpenToSide: boolean;
  /** Where the empty view's ahead / behind counts lead. */
  syncLinks: SyncLinks;
}

/**
 * The task's working changes as staged and unstaged trees in one `FileTree`,
 * narrow and expanded alike: a stage tick at each row's left edge, discard
 * and .gitignore on hover; or the commit run while one is shown. With
 * nothing changed, where the branch stands against its upstream.
 */
export function FileChangesPanel({
  cwd,
  loading,
  run,
  onOpenChange,
  activePath,
  view,
  canOpenToSide,
  syncLinks,
}: FileChangesPanelProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const files = gitStatus?.files;
  const sections = useMemo(() => changeSections(files ?? []), [files]);
  const selected = useMemo(
    () => changeSelection(activePath, view, files ?? []),
    [activePath, view, files],
  );

  if (!gitStatus) {
    return <EmptyState title={loading ? 'Loading…' : 'No task selected'} />;
  }

  const runState = run.state;
  if (
    runState.status === 'running' ||
    runState.status === 'failed' ||
    runState.status === 'cancelled'
  ) {
    const unstaged = new Set(gitStatus.files.filter((f) => !f.staged).map((f) => f.path));
    const autoFixPaths = run.autoFixPaths(unstaged);
    return (
      <div className="flex min-h-0 flex-1 flex-col animate-fade-in">
        <CommitRunView
          state={runState as Exclude<CommitRunState, { status: 'idle' } | { status: 'success' }>}
          autoFixCount={autoFixPaths.length}
          onCancel={run.cancel}
          onBackToFiles={run.dismiss}
          onStageFixesAndRetry={() => {
            run.stageFixesAndRetry(autoFixPaths).catch((err: unknown) => {
              toast.error(err instanceof Error ? err.message : 'Retry failed');
            });
          }}
        />
      </div>
    );
  }

  if (gitStatus.files.length === 0) {
    return (
      <EmptyState
        illustration={FileDiff}
        title="No changes"
        description={<SyncStatus status={gitStatus} links={syncLinks} look="muted" />}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in">
      <FileTree
        sections={sections}
        cwd={cwd}
        selected={selected}
        onOpenFile={(row, opts) => onOpenChange(row.file.path, row.section === 'staged', opts)}
        canOpenToSide={canOpenToSide}
        leading={(row) => <StageTick row={row} />}
        actions={(row) => <ChangeActions row={row} />}
      />
    </div>
  );
}

/** Stage or unstage a file, or every change in a folder. */
function StageTick({ row }: { row: ItemRow }) {
  const checked: boolean | 'mixed' =
    row.kind === 'file'
      ? !!row.file.change?.staged
      : row.folder.tally.staged === 0
        ? false
        : row.folder.tally.staged === row.folder.tally.changed
          ? true
          : 'mixed';
  const noun = row.kind === 'folder' ? ' folder' : '';
  return (
    <Checkbox
      checked={checked}
      aria-label={checked === true ? `Unstage${noun}` : `Stage${noun}`}
      onChange={() => {
        const paths =
          row.kind === 'file' ? [row.file.path] : subtreeChanges(row.folder).map((c) => c.path);
        const git = useGit.getState();
        void (row.section === 'staged' ? git.unstageFiles(paths) : git.stageFiles(paths));
      }}
    />
  );
}

/** A change's hover actions: .gitignore an untracked file or folder, discard
 *  unstaged changes (a folder's after a confirm). None: the tree's default. */
function ChangeActions({ row }: { row: ItemRow }) {
  if (row.kind === 'file') {
    const change = row.file.change;
    if (!change) return null;
    const { canDiscard, canIgnore } = fileActions(change);
    if (!canDiscard && !canIgnore) return null;
    return (
      <>
        {canIgnore && <IgnoreAction path={change.path} folder={false} />}
        {canDiscard && (
          <IconButton
            title="Discard changes"
            size="sm"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              void useGit.getState().discardFiles([change.path]);
            }}
          >
            <Undo2 size={14} strokeWidth={1.8} />
          </IconButton>
        )}
      </>
    );
  }
  const { discardable, canIgnore } = folderActions(row.folder);
  if (discardable.length === 0 && !canIgnore) return null;
  return (
    <>
      {canIgnore && <IgnoreAction path={`${row.folder.path}/`} folder />}
      {discardable.length > 0 && (
        <DiscardFolderAction name={row.name} folderPath={row.folder.path} paths={discardable} />
      )}
    </>
  );
}

function IgnoreAction({ path, folder }: { path: string; folder: boolean }) {
  return (
    <IconButton
      title={folder ? 'Add folder to .gitignore' : 'Add to .gitignore'}
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        void useGit.getState().addToGitignore(path);
      }}
    >
      <EyeOff size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/** Discard a folder's unstaged changes, after a confirm listing them. */
function DiscardFolderAction({
  name,
  folderPath,
  paths,
}: {
  name: string;
  folderPath: string;
  paths: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          title="Discard folder changes"
          size="sm"
          variant="destructive"
          onClick={(e) => e.stopPropagation()}
        >
          <Undo2 size={14} strokeWidth={1.8} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" sideOffset={8} onClick={(e) => e.stopPropagation()}>
        <DiscardFolderConfirm
          folderName={name}
          folderBasePath={folderPath}
          paths={paths}
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            await useGit.getState().discardFiles(paths);
            setOpen(false);
          }}
        />
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}
