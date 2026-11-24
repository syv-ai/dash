import { useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PrProvider } from '../../../../shared/types';
import { prKey, reviewKey, usePrReviews } from '../../../stores/prReviewStore';
import { Checkbox } from '../../ui/Checkbox';
import { IconButton } from '../../ui/IconButton';
import { fileRows, viewedBlob } from '../../review/outline';
import type { ReviewNav } from './useReviewNavigation';

const NO_MARKS: Record<string, string> = {};

/**
 * A PR view's reading controls in its file's toolbar (D-R2c): previous and
 * next thread or draft (⇧⌥F9 / ⌥F9), and the Viewed tick for the file (a
 * file the PR doesn't change has none).
 */
export function PrFileActions({
  pr,
  taskId,
  filePath,
  nav,
}: {
  pr: { provider: PrProvider; number: number };
  taskId: string;
  filePath: string;
  /** The groups' navigation: its buttons step the focused group, this one
   *  once clicked into. */
  nav: Pick<ReviewNav, 'canStep' | 'step'>;
}) {
  const { provider, number } = pr;
  const review = usePrReviews((s) => s.byPr[prKey(provider, number)] ?? null);
  const marks = usePrReviews((s) => s.viewed[reviewKey(taskId, provider, number)]);
  useEffect(() => {
    if (marks === undefined) void usePrReviews.getState().loadViewed(taskId, provider, number);
  }, [marks, taskId, provider, number]);
  const row = useMemo(
    () =>
      review
        ? fileRows(
            review.files.filter((f) => f.path === filePath),
            [],
            marks ?? NO_MARKS,
            [],
          )[0]
        : undefined,
    [review, marks, filePath],
  );

  return (
    <>
      <IconButton
        size="sm"
        title="Previous thread or draft (⇧⌥F9)"
        disabled={!nav.canStep}
        onClick={() => nav.step(-1)}
      >
        <ChevronUp size={14} strokeWidth={1.8} />
      </IconButton>
      <IconButton
        size="sm"
        title="Next thread or draft (⌥F9)"
        disabled={!nav.canStep}
        onClick={() => nav.step(1)}
      >
        <ChevronDown size={14} strokeWidth={1.8} />
      </IconButton>
      {row && (
        <label className="type-label flex cursor-pointer items-center gap-1.5 px-1.5">
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
    </>
  );
}
