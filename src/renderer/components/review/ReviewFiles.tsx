import { useId, useMemo } from 'react';
import type { PrReview } from '../../../shared/types';
import { useUi } from '../../stores/uiStore';
import { EditorTree } from '../diffEditor/EditorTree';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import { Switch } from '../ui/Switch';
import { TextLink } from '../ui/TextLink';
import { nextUnviewed, prFileChanges, treeBadges, viewedPaths, type FileRow } from './outline';

/** Every file at the PR's head, as the editor's workspace lists them. */
export interface RepoFiles {
  paths: string[];
  dirs: string[];
  loading: boolean;
}

/**
 * Review mode's Files tab: how far the reading has got ("Viewed n of m.
 * Review next") over one tree, the PR's changed files by default, or with
 * "All files" every file at its head; changed files are badged with their
 * open threads and the person's draft comments, viewed ones ticked and dimmed.
 */
export function ReviewFiles({
  review,
  rows,
  repo,
  cwd,
  activePath,
  canOpenToSide,
  onOpenFile,
}: {
  review: PrReview;
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
  const viewed = useMemo(() => viewedPaths(rows), [rows]);
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
  const next = nextUnviewed(rows, activePath);
  const allFiles = useUi((s) => s.reviewAllFiles);
  const toggleId = useId();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {rows.length > 0 && (
        <p className="type-body shrink-0 px-3 pt-2 tabular-nums">
          Viewed {viewed.size} of {rows.length}.
          {next && (
            <>
              {' '}
              <TextLink title={next} onClick={() => onOpenFile(next, { preview: true })}>
                Review next
              </TextLink>
            </>
          )}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <EditorTree
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
            <label htmlFor={toggleId} className="flex cursor-pointer items-center gap-1.5">
              All files
              <Switch
                id={toggleId}
                size="sm"
                checked={allFiles}
                onCheckedChange={(v) => useUi.getState().setReviewAllFiles(v)}
              />
            </label>
          }
        />
      </div>
    </div>
  );
}
