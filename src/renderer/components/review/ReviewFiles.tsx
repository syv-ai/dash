import { useCallback, useMemo } from 'react';
import type { PrReview } from '../../../shared/types';
import { usePrReviews } from '../../stores/prReviewStore';
import { useUi } from '../../stores/uiStore';
import { AllFilesSwitch } from '../fileTree/AllFilesSwitch';
import { RepoTree, type ViewedColumn } from '../fileTree/RepoTree';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import { prFileChanges, treeBadges, viewedBlob, viewedPaths, type FileRow } from './outline';

/** Every file at the PR's head, as the editor's workspace lists them. */
export interface RepoFiles {
  paths: string[];
  dirs: string[];
  loading: boolean;
}

/**
 * Review mode's Files tab: one tree, the PR's changed files by default, or
 * with "Show filetree" every file at its head. Changed files are badged with their
 * open threads and the person's draft comments; hovering one (or Space) marks
 * it viewed or not, a viewed one quiet with a check beside its counts; the top
 * row tallies "n viewed" beside the switch.
 */
export function ReviewFiles({
  review,
  taskId,
  rows,
  repo,
  cwd,
  activePath,
  canOpenToSide,
  onOpenFile,
}: {
  review: PrReview;
  taskId: string;
  /** The outline's file rows (viewed marks and counts). */
  rows: readonly FileRow[];
  repo: RepoFiles;
  cwd: string;
  activePath: string | null;
  /** The editor shows one group: a file's menu offers "Open in new pane". */
  canOpenToSide: boolean;
  onOpenFile: (path: string, opts?: OpenOptions) => void;
}) {
  const changes = useMemo(() => prFileChanges(review.files), [review.files]);
  const badges = useMemo(() => treeBadges(rows), [rows]);
  const paths = useMemo(() => viewedPaths(rows), [rows]);
  const onToggle = useCallback(
    (path: string, viewed: boolean) => {
      const row = rows.find((r) => r.file.path === path);
      if (!row) return;
      usePrReviews
        .getState()
        .setViewed(
          taskId,
          review.provider,
          review.number,
          path,
          viewed ? viewedBlob(row.file) : null,
        );
    },
    [rows, taskId, review.provider, review.number],
  );
  const viewed = useMemo<ViewedColumn>(() => ({ paths, onToggle }), [paths, onToggle]);
  // The tree lists by the PR's own files, not the editor's view, so it reads
  // the same while the editor catches up (or is closed, narrow).
  const view = useMemo<EditorView>(
    () => ({
      kind: 'pr',
      provider: review.provider,
      number: review.number,
      base: review.base,
      head: review.head,
    }),
    [review.provider, review.number, review.base, review.head],
  );
  const allFiles = useUi((s) => s.reviewAllFiles);

  return (
    <div className="h-full min-h-0">
      <RepoTree
        cwd={cwd}
        git
        view={view}
        allPaths={allFiles ? repo.paths : []}
        repoDirs={allFiles ? repo.dirs : undefined}
        changedFiles={changes}
        changedOnly={!allFiles}
        filesLoading={allFiles && repo.loading}
        selectedPath={activePath ?? ''}
        onOpenFile={onOpenFile}
        canOpenToSide={canOpenToSide}
        badgeCounts={badges}
        viewed={viewed}
        headerAction={
          <AllFilesSwitch
            checked={allFiles}
            onChange={(v) => useUi.getState().setReviewAllFiles(v)}
          />
        }
      />
    </div>
  );
}
