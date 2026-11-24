import { useMemo } from 'react';
import type { PrReview } from '../../../shared/types';
import { EditorTree } from '../diffEditor/EditorTree';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorView } from '../diffEditor/types';
import { TextLink } from '../ui/TextLink';
import { nextUnviewed, prFileChanges, treeBadges, viewedPaths, type FileRow } from './outline';

/**
 * The Review view's Changes tab: how far the reading has got ("Viewed n of m.
 * Review next") over the Files tree of the PR's files, each badged with its
 * open threads and the person's draft comments, viewed ones ticked and dimmed.
 */
export function ReviewChanges({
  review,
  rows,
  cwd,
  activePath,
  canOpenToSide,
  onOpenFile,
}: {
  review: PrReview;
  /** The outline's file rows (viewed marks and counts). */
  rows: readonly FileRow[];
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
          allPaths={[]}
          changedFiles={changes}
          changedOnly
          filesLoading={false}
          selectedPath={activePath ?? ''}
          onOpenFile={onOpenFile}
          canOpenToSide={canOpenToSide}
          badgeCounts={badges}
          viewed={viewed}
        />
      </div>
    </div>
  );
}
