import { useMemo } from 'react';
import { frozenCommit, type EditorView, type CommitSummary } from '../types';
import type { FileChange } from '../../../../shared/types';
import { useAsyncResource } from './useAsyncResource';

const NO_FILES: FileChange[] = [];
const NO_PATHS: string[] = [];
const NO_COMMITS: CommitSummary[] = [];

export interface EditorViewData {
  changedFiles: FileChange[];
  changedFilesLoading: boolean;
  repoPaths: string[];
  repoPathsLoading: boolean;
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
  const repoPaths = useAsyncResource<string[]>(
    () =>
      window.electronAPI
        .editorListRepoFiles({ cwd, source: repoSource })
        .then((r) => (r.success && r.data ? r.data : NO_PATHS)),
    [cwd, isCommit ? commitHash : 'working', enabled.files],
    NO_PATHS,
    enabled.files,
  );

  const commits = useAsyncResource<CommitSummary[]>(
    () =>
      window.electronAPI.editorListCommits({ cwd, limit: 50 }).then((r) =>
        r.success && r.data
          ? r.data.map((c) => ({
              hash: c.hash,
              shortHash: c.shortHash,
              subject: c.subject,
              body: c.body,
              authorName: c.authorName,
              authorDate: c.authorDate,
              additions: c.additions,
              deletions: c.deletions,
            }))
          : NO_COMMITS,
      ),
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

  return useMemo(
    () => ({
      changedFiles,
      changedFilesLoading,
      repoPaths: repoPaths.data,
      repoPathsLoading: repoPaths.loading,
      commits: commits.data,
      commitsLoading: commits.loading,
      defaultBase: defaultBase.data,
    }),
    [
      changedFiles,
      changedFilesLoading,
      repoPaths.data,
      repoPaths.loading,
      commits.data,
      commits.loading,
      defaultBase.data,
    ],
  );
}
