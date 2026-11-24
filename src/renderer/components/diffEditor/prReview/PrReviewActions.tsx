import { useEffect, useMemo } from 'react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { PrProvider } from '../../../../shared/types';
import { prKey, reviewKey, usePrReviews } from '../../../stores/prReviewStore';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { IconButton } from '../../ui/IconButton';
import { fileRows, nextUnviewed, viewedBlob } from '../../review/outline';
import type { NavDirection } from './useReviewNavigation';

const NO_MARKS: Record<string, string> = {};

/**
 * The PR view's reading controls, in the tab strip's trailing slot: previous
 * and next thread or draft (⇧⌥F9 / ⌥F9) in the focused pane, a Viewed tick
 * for its file, and once it is viewed, Next unviewed. Shown only while a
 * file is the focused group's tab.
 */
export function PrReviewActions({
  pr,
  taskId,
  canStep,
  onStep,
  activePath,
  onOpenFile,
}: {
  pr: { provider: PrProvider; number: number };
  taskId: string;
  /** There is a thread or draft to step to. */
  canStep: boolean;
  /** Step the focused group's pane to the next (1) or previous (-1) one. */
  onStep: (dir: NavDirection) => void;
  /** The file showing in it; null for none or a non-file tab. */
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const { provider, number } = pr;
  const review = usePrReviews((s) => s.byPr[prKey(provider, number)] ?? null);
  const marks = usePrReviews((s) => s.viewed[reviewKey(taskId, provider, number)]);
  useEffect(() => {
    if (marks === undefined) void usePrReviews.getState().loadViewed(taskId, provider, number);
  }, [marks, taskId, provider, number]);

  const rows = useMemo(
    () => (review ? fileRows(review.files, [], marks ?? NO_MARKS, []) : []),
    [review, marks],
  );
  // Nothing to read through without a file showing (none, or the overview tab).
  if (!review || activePath === null) return null;

  const row = rows.find((r) => r.file.path === activePath);
  const next = row?.viewed ? nextUnviewed(rows, row.file.path) : null;
  return (
    <>
      <IconButton
        size="sm"
        title="Previous thread or draft (⇧⌥F9)"
        disabled={!canStep}
        onClick={() => onStep(-1)}
      >
        <ChevronUp size={14} strokeWidth={1.8} />
      </IconButton>
      <IconButton
        size="sm"
        title="Next thread or draft (⌥F9)"
        disabled={!canStep}
        onClick={() => onStep(1)}
      >
        <ChevronDown size={14} strokeWidth={1.8} />
      </IconButton>
      {row && (
        <label className="type-caption flex cursor-pointer items-center gap-1.5 px-1.5">
          <Checkbox
            checked={row.viewed}
            aria-label={row.viewed ? 'Mark not viewed' : 'Mark viewed'}
            onChange={() =>
              usePrReviews
                .getState()
                .setViewed(
                  taskId,
                  provider,
                  number,
                  row.file.path,
                  row.viewed ? null : viewedBlob(row.file),
                )
            }
          />
          Viewed
        </label>
      )}
      {next && (
        <Button size="sm" variant="ghost" onClick={() => onOpenFile(next)}>
          Next unviewed
          <ArrowRight size={14} strokeWidth={1.8} />
        </Button>
      )}
    </>
  );
}
