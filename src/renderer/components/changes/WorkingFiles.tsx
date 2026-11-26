import { useMemo, useState } from 'react';
import { EyeOff, FileDiff, Minus, Plus, Undo2 } from 'lucide-react';
import { toast } from '../ui/toast';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { AllFilesSwitch } from '../fileTree/AllFilesSwitch';
import { FilesTopRow } from '../fileTree/FilesTopRow';
import { FileTree } from '../fileTree/FileTree';
import { RepoTree, TreeHeader, TreeTally } from '../fileTree/RepoTree';
import { buildTree, type FileBadges, type FolderTally, type ItemRow } from '../fileTree/model';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import type { FilesScope } from '../rightInspector/filesScope';
import { CommitRunView } from './CommitRunView';
import { DiscardFolderConfirm } from './DiscardFolderConfirm';
import { isOutOfSync, SyncText, SyncTextLeast, type SyncLinks } from './SyncStatus';
import {
  changeSections,
  changeSelection,
  fileActions,
  folderActions,
  oneChangePerPath,
  stageAction,
  withStaged,
  type StageAction,
} from './changeSections';
import type { CommitRun } from './useCommitRun';
import type { CommitRunState } from './commitRunReducer';
import type { FileChange } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';

/** The repo at the editor's view, for all files. */
export interface RepoView {
  /** `cwd` is a task's worktree. */
  git: boolean;
  paths: readonly string[];
  dirs: readonly string[];
  /** The view's changes (the working tree's, or a commit's). */
  changedFiles: readonly FileChange[];
  loading: boolean;
  badges: ReadonlyMap<string, FileBadges>;
}

interface WorkingFilesProps {
  cwd: string;
  loading: boolean;
  scope: FilesScope;
  onScope: (scope: FilesScope) => void;
  /** The commit in flight (or just finished): shown in place of the changes. */
  run: CommitRun;
  /** Open a change's diff: staged against HEAD, or the working tree's. A
   *  click previews it (`preview`), ⌥-click opens it beside (`toSide`). */
  onOpenChange: (path: string, staged: boolean, opts?: OpenOptions) => void;
  /** Open a file of the whole repo in the editor's view. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** The editor's file and view: its row reads as current. */
  activePath: string | null;
  view: EditorView;
  canOpenToSide: boolean;
  repo: RepoView;
  /** Where the sync text's ahead / behind counts lead. */
  syncLinks: SyncLinks;
}

const NO_FILES: readonly FileChange[] = [];

/**
 * Normal mode's Files: a top row with where the branch stands against its
 * upstream (while they differ; else the changes' tally, as review Files' row
 * has, D269) and the "Show filetree" switch, then one tree. Off
 * (`changed`), the working tree's changes as staged and unstaged sections,
 * or the commit run while one is shown (no switch), or "No changes" with the
 * sync text under it instead; on (`all`), every file with its changes, a staged one's letter boxed. Changed
 * rows swap their line counts for stage (or unstage), .gitignore and discard
 * on hover, and Space stages too, either way (all files: in the working tree's
 * view, which those act on).
 */
export function WorkingFiles({
  cwd,
  loading,
  scope,
  onScope,
  run,
  onOpenChange,
  onOpenFile,
  activePath,
  view,
  canOpenToSide,
  repo,
  syncLinks,
}: WorkingFilesProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const changedOnly = scope === 'changed';
  const working = repo.git && view.kind === 'working';
  const files = gitStatus?.files ?? NO_FILES;
  const merged = useMemo(() => oneChangePerPath(files), [files]);
  // The tree's changes: the working tree's (merged per path), or, all files
  // at another view, that view's.
  const shown = changedOnly || working ? merged : repo.changedFiles;
  const tally = useMemo(() => buildTree(shown).tally, [shown]);
  if (!gitStatus) {
    return <EmptyState title={loading ? 'Loading…' : 'No task selected'} />;
  }
  const showingRun = changedOnly && isShowingRun(run.state);
  const outOfSync = isOutOfSync(gitStatus);
  // No sync text to show: the tally takes its place in the top row.
  const tallyInRow = !outOfSync && !showingRun && tally.changed > 0;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <FilesTopRow
        start={
          outOfSync ? (
            <SyncText status={gitStatus} links={syncLinks} />
          ) : (
            tallyInRow && <TreeTally tally={tally} />
          )
        }
        startLeast={outOfSync ? <SyncTextLeast status={gitStatus} /> : undefined}
        end={
          !showingRun && (
            <AllFilesSwitch
              checked={!changedOnly}
              onChange={(all) => onScope(all ? 'all' : 'changed')}
            />
          )
        }
      />
      {changedOnly ? (
        <ChangedFiles
          files={gitStatus.files}
          tally={tallyInRow ? null : tally}
          cwd={cwd}
          run={run}
          onOpenChange={onOpenChange}
          activePath={activePath}
          view={view}
          canOpenToSide={canOpenToSide}
        />
      ) : (
        <AllFiles
          files={gitStatus.files}
          merged={merged}
          tally={!tallyInRow}
          working={working}
          cwd={cwd}
          onOpenFile={onOpenFile}
          activePath={activePath}
          view={view}
          canOpenToSide={canOpenToSide}
          repo={repo}
        />
      )}
    </div>
  );
}

/** The commit run shows in place of the changes (a success is the footer's). */
const isShowingRun = (
  state: CommitRunState,
): state is Exclude<CommitRunState, { status: 'idle' } | { status: 'success' }> =>
  state.status === 'running' || state.status === 'failed' || state.status === 'cancelled';

/** The changes alone: Staged, then Unstaged. */
function ChangedFiles({
  files,
  tally,
  cwd,
  run,
  onOpenChange,
  activePath,
  view,
  canOpenToSide,
}: {
  files: readonly FileChange[];
  /** Its tally, drawn above the tree; null: the top row shows it. */
  tally: FolderTally | null;
  cwd: string;
  run: CommitRun;
  onOpenChange: WorkingFilesProps['onOpenChange'];
  activePath: string | null;
  view: EditorView;
  canOpenToSide: boolean;
}) {
  const sections = useMemo(() => changeSections(files), [files]);
  const selected = useMemo(
    () => changeSelection(activePath, view, files),
    [activePath, view, files],
  );

  const runState = run.state;
  if (isShowingRun(runState)) {
    const unstaged = new Set(files.filter((f) => !f.staged).map((f) => f.path));
    const autoFixPaths = run.autoFixPaths(unstaged);
    return (
      <div className="flex min-h-0 flex-1 flex-col animate-fade-in">
        <CommitRunView
          state={runState}
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

  if (files.length === 0) {
    return <EmptyState illustration={FileDiff} title="No changes" />;
  }

  return (
    <>
      {tally && <TreeHeader tally={tally} />}
      <FileTree
        sections={sections}
        cwd={cwd}
        selected={selected}
        onOpenFile={(row, opts) => onOpenChange(row.file.path, row.section === 'staged', opts)}
        canOpenToSide={canOpenToSide}
        actions={(row) => <ChangeActions row={row} files={files} />}
        spaceAction={(row) => stageToggle(row, files)}
        gapAbove={!tally}
      />
    </>
  );
}

/** Every file at the editor's view, its changes marked (and, in the working
 *  tree's view, staged and discarded from here too). */
function AllFiles({
  files,
  merged,
  tally,
  working,
  cwd,
  onOpenFile,
  activePath,
  view,
  canOpenToSide,
  repo,
}: {
  files: readonly FileChange[];
  /** `files`, one change per path. */
  merged: readonly FileChange[];
  /** Draws the tree's tally (false: the top row shows it). */
  tally: boolean;
  working: boolean;
  cwd: string;
  onOpenFile: WorkingFilesProps['onOpenFile'];
  activePath: string | null;
  view: EditorView;
  canOpenToSide: boolean;
  repo: RepoView;
}) {
  const badges = useMemo(
    () => (working ? withStaged(repo.badges, files) : repo.badges),
    [working, repo.badges, files],
  );
  return (
    <div className="min-h-0 flex-1">
      <RepoTree
        cwd={cwd}
        git={repo.git}
        view={view}
        allPaths={repo.paths}
        repoDirs={repo.dirs}
        changedFiles={working ? merged : repo.changedFiles}
        changedOnly={false}
        filesLoading={repo.loading}
        selectedPath={activePath ?? ''}
        onOpenFile={onOpenFile}
        canOpenToSide={canOpenToSide}
        badgeCounts={badges}
        actions={working ? (row) => <ChangeActions row={row} files={files} /> : undefined}
        spaceAction={working ? (row) => stageToggle(row, files) : undefined}
        tally={tally}
      />
    </div>
  );
}

const runStage = ({ stage, paths }: StageAction) => {
  const git = useGit.getState();
  void (stage ? git.stageFiles(paths) : git.unstageFiles(paths));
};

/** Space on a changed row: stage or unstage it. */
const stageToggle = (row: ItemRow, files: readonly FileChange[]) => {
  const action = stageAction(row, files);
  return action && (() => runStage(action));
};

function StageButton({ action, folder }: { action: StageAction; folder: boolean }) {
  const Icon = action.stage ? Plus : Minus;
  return (
    <IconButton
      title={`${action.stage ? 'Stage' : 'Unstage'}${folder ? ' folder' : ''}`}
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        runStage(action);
      }}
    >
      <Icon size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/** A change's hover actions: stage or unstage it, .gitignore an untracked
 *  file or folder, discard unstaged changes (a folder's after a confirm).
 *  None: the tree's default. */
function ChangeActions({ row, files }: { row: ItemRow; files: readonly FileChange[] }) {
  const stage = stageAction(row, files);
  const stageButton = stage && <StageButton action={stage} folder={row.kind === 'folder'} />;
  if (row.kind === 'file') {
    const change = row.file.change;
    if (!change) return null;
    const { canDiscard, canIgnore } = fileActions(change);
    if (!stage && !canDiscard && !canIgnore) return null;
    return (
      <>
        {stageButton}
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
  if (!stage && discardable.length === 0 && !canIgnore) return null;
  return (
    <>
      {stageButton}
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
