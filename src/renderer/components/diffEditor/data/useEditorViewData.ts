import { useMemo } from 'react';
import { frozenCommit, type EditorView, type CommitSummary } from '../types';
import type { FileChange, RepoListing } from '../../../../shared/types';
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
  /** The changed files and repo paths answer the current view. */
  settled: boolean;
  commits: CommitSummary[];
  commitsLoading: boolean;
  defaultBase: string | null;
}

/** Which reads run: the editor's (files, base), and the commit list (History). */
export interface ViewDataEnabled {
  files: boolean;
  commits: boolean;
}

/** Composes the view-dependent git reads (commit files, branch files, repo
 *  paths, commits, default base) behind one hook. Owns no view/selection
 *  state — those stay in the workspace; this just turns (cwd, view,
 *  workingFiles) into the merged data the sidebar + pane consume. Without
 *  `git` (a folder that is no task's worktree) only its files are listed. */
export function useEditorViewData(
  cwd: string,
  view: EditorView,
  workingFiles: FileChange[],
  git: boolean,
  enabled: ViewDataEnabled = { files: true, commits: true },
): EditorViewData {
  const frozen = frozenCommit(view);
  const isCommit = frozen !== null && enabled.files;
  const isBranch = view.kind === 'branch' && enabled.files;
  const commitHash = frozen?.hash ?? '';
  const commitBase = frozen?.base;
  const branchBase = isBranch ? view.base : '';

  const commitFiles = useAsyncResource<FileChange[]>(
    () =>
      window.electronAPI
        .editorListFilesInCommit({ cwd, hash: commitHash, base: commitBase })
        .then((r) => (r.success && r.data ? r.data : NO_FILES)),
    [cwd, commitHash, commitBase, isCommit],
    NO_FILES,
    isCommit,
  );

  const branchFiles = useAsyncResource<FileChange[]>(
    () =>
      window.electronAPI
        .editorListFilesAgainstBase({ cwd, base: branchBase })
        .then((r) => (r.success && r.data ? r.data : NO_FILES)),
    [cwd, branchBase, isBranch],
    NO_FILES,
    isBranch,
  );

  const repoSource = isCommit
    ? ({ kind: 'commit', hash: commitHash } as const)
    : ({ kind: 'working' } as const);
  const repoListing = useAsyncResource<RepoListing>(
    () =>
      window.electronAPI
        .editorListRepoFiles({ cwd, source: repoSource })
        .then((r) => (r.success && r.data ? r.data : NO_LISTING)),
    [cwd, isCommit ? commitHash : 'working', enabled.files],
    NO_LISTING,
    enabled.files,
  );

  const commits = useAsyncResource<CommitSummary[]>(
    () => listCommits(cwd, 50),
    [cwd, git, enabled.commits],
    NO_COMMITS,
    git && enabled.commits,
  );

  const defaultBase = useAsyncResource<string | null>(
    () =>
      window.electronAPI
        .editorResolveDefaultBase({ cwd })
        .then((r) => (r.success ? (r.data ?? null) : null)),
    [cwd, git, enabled.files],
    null,
    git && enabled.files,
  );

  // A frozen or branch view's files load with the editor; until then, none.
  const changedFiles = isCommit
    ? commitFiles.data
    : isBranch
      ? branchFiles.data
      : view.kind === 'working'
        ? workingFiles
        : NO_FILES;
  const changedFilesLoading = isCommit
    ? commitFiles.loading
    : isBranch
      ? branchFiles.loading
      : false;
  const settled =
    (isCommit ? commitFiles.settled : isBranch ? branchFiles.settled : true) && repoListing.settled;

  return useMemo(
    () => ({
      changedFiles,
      changedFilesLoading,
      repoPaths: repoListing.data.files,
      repoPathsLoading: repoListing.loading,
      repoDirs: repoListing.data.dirs,
      settled,
      commits: commits.data,
      commitsLoading: commits.loading,
      defaultBase: defaultBase.data,
    }),
    [
      changedFiles,
      changedFilesLoading,
      repoListing.data,
      repoListing.loading,
      settled,
      commits.data,
      commits.loading,
      defaultBase.data,
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
