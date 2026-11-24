import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { ProgressRing } from '../ui/ProgressRing';
import { nextUnviewed, type FileRow } from './outline';

/** How much of the PR has been read: a ring, "Viewed x of y files", and a
 *  button to the next unviewed file after the open one. */
export function ReviewProgress({
  rows,
  activePath,
  onOpenFile,
}: {
  rows: readonly FileRow[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  if (rows.length === 0) return null;
  const viewed = rows.filter((r) => r.viewed).length;
  const next = nextUnviewed(rows, activePath);
  const label = `Viewed ${viewed} of ${rows.length} files`;
  return (
    <div className="flex flex-wrap items-center gap-2 px-2.5 pt-3">
      <ProgressRing value={(viewed / rows.length) * 100} size={20} stroke={3} aria-label={label} />
      <span className="type-body min-w-0 flex-1 tabular-nums">{label}</span>
      {next && (
        <Button size="sm" variant="secondary" onClick={() => onOpenFile(next)}>
          Next unviewed
          <ArrowRight size={14} strokeWidth={1.8} />
        </Button>
      )}
    </div>
  );
}
