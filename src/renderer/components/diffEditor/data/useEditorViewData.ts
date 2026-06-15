import { useMemo } from 'react';
import type { EditorView, CommitSummary } from '../types';
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

/** Composes the view-dependent git reads (commit files, branch files, repo
 *  paths, commits, default base) behind one hook. Owns no view/selection
 *  state — those stay in the workspace; this just turns (cwd, view,
 *  workingFiles) into the merged data the sidebar + pane consume. */
export function useEditorViewData(
  cwd: string,
  view: EditorView,
  workingFiles: FileChange[],
): EditorViewData {
  const isCommit = view.kind === 'commit';
  const isBranch = view.kind === 'branch';
  const commitHash = isCommit ? view.hash : '';
  const branchBase = isBranch ? view.base : '';

  const commitFiles = useAsyncResource<FileChange[]>(
    () =>
      window.electronAPI
        .editorListFilesInCommit({ cwd, hash: commitHash })
        .then((r) => (r.success && r.data ? r.data : NO_FILES)),
    [cwd, commitHash, isCommit],
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
    [cwd, isCommit ? commitHash : 'working'],
    NO_PATHS,
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
            }))
          : NO_COMMITS,
      ),
    [cwd],
    NO_COMMITS,
  );

  const defaultBase = useAsyncResource<string | null>(
    () =>
      window.electronAPI
        .editorResolveDefaultBase({ cwd })
        .then((r) => (r.success ? (r.data ?? null) : null)),
    [cwd],
    null,
  );

  const changedFiles = isCommit ? commitFiles.data : isBranch ? branchFiles.data : workingFiles;
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
