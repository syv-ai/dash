import { useMemo } from 'react';
import { frozenCommit, type EditorView, type CommitSummary } from '../types';
import type { FileChange, RepoListing } from '../../../../shared/types';
import { useTreeVersion } from '../../fileTree/useTreeVersion';
import { useAsyncResource } from './useAsyncResource';

const NO_FILES: FileChange[] = [];
const NO_LISTING: RepoListing = { files: [], dirs: [] };
const NO_COMMITS: CommitSummary[] = [];

export interface EditorViewData {
  changedFiles: FileChange[];
  changedFilesLoading: boolean;
  repoPaths: string[];
  repoPathsLoading: boolean;
  /** Directories git lists as one entry (symlinked ones): the tree lists
   *  them lazily. */
  repoDirs: string[];
  /** The working tree's gitignored files and folders, read with its paths
   *  (none for a commit's tree). */
  repoIgnored: RepoListing;
  /** The changed files and repo paths answer the current view. */
  settled: boolean;
  commits: CommitSummary[];
  commitsLoading: boolean;
}

/** Which reads run: the editor's files, and the commit list (History). */
export interface ViewDataEnabled {
  files: boolean;
  commits: boolean;
}

/** Composes the view-dependent git reads (a commit's or PR's files, repo
 *  paths, commits) behind one hook. Owns no view/selection
 *  state — those stay in the workspace; this just turns (cwd, view,
 *  workingFiles) into the merged data the sidebar + pane consume. Without
 *  `git` (a folder that is no task's worktree) only its files are listed.
 *  The commit list reloads when `headSha` moves (a commit or checkout made
 *  anywhere), showing the old list until the new one is in. */
export function useEditorViewData(
  cwd: string,
  view: EditorView,
  workingFiles: FileChange[],
  headSha: string | null,
  git: boolean,
  enabled: ViewDataEnabled = { files: true, commits: true },
): EditorViewData {
  const frozen = frozenCommit(view);
  const isCommit = frozen !== null && enabled.files;
  const commitHash = frozen?.hash ?? '';
  const commitBase = frozen?.base;

  const commitFiles = useAsyncResource<FileChange[]>(
    () =>
      window.electronAPI
        .editorListFilesInCommit({ cwd, hash: commitHash, base: commitBase })
        .then((r) => (r.success && r.data ? r.data : NO_FILES)),
    [cwd, commitHash, commitBase, isCommit],
    NO_FILES,
    isCommit,
  );

  const repoSource = isCommit
    ? ({ kind: 'commit', hash: commitHash } as const)
    : ({ kind: 'working' } as const);
  // The working tree's listing follows the disk: a file made, deleted or
  // moved out by anyone reloads it (git status alone misses a listed path
  // going away, and ignored files entirely).
  const treeVersion = useTreeVersion(cwd, enabled.files && !isCommit);
  const repoListing = useAsyncResource<RepoListing>(
    () =>
      window.electronAPI
        .editorListRepoFiles({ cwd, source: repoSource })
        .then((r) => (r.success && r.data ? r.data : NO_LISTING)),
    [cwd, isCommit ? commitHash : 'working', enabled.files],
    NO_LISTING,
    enabled.files,
    isCommit ? 0 : treeVersion,
  );

  const commits = useAsyncResource<CommitSummary[]>(
    () => listCommits(cwd, 50),
    [cwd, git, enabled.commits, headSha],
    NO_COMMITS,
    git && enabled.commits,
  );

  // A frozen view's files load with the editor; until then, none.
  const changedFiles = isCommit
    ? commitFiles.data
    : view.kind === 'working'
      ? workingFiles
      : NO_FILES;
  const changedFilesLoading = isCommit && commitFiles.loading;
  const settled = (!isCommit || commitFiles.settled) && repoListing.settled;

  return useMemo(
    () => ({
      changedFiles,
      changedFilesLoading,
      repoPaths: repoListing.data.files,
      repoPathsLoading: repoListing.loading,
      repoDirs: repoListing.data.dirs,
      repoIgnored: repoListing.data.ignored ?? NO_LISTING,
      settled,
      commits: commits.data,
      commitsLoading: commits.loading,
    }),
    [
      changedFiles,
      changedFilesLoading,
      repoListing.data,
      repoListing.loading,
      settled,
      commits.data,
      commits.loading,
    ],
  );
}

/** The newest `limit` commits of HEAD at `cwd`, or of `range` (a PR's
 *  base..head); none when git can't say. */
export function listCommits(
  cwd: string,
  limit: number,
  range?: { base: string; head: string },
): Promise<CommitSummary[]> {
  return window.electronAPI
    .editorListCommits({ cwd, limit, range })
    .then((r) => (r.success && r.data ? r.data : NO_COMMITS));
}
