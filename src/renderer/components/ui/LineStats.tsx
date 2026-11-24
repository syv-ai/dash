import { cn } from '../../lib/cn';

/**
 * Lines added and deleted, "+12 −3", in the app's one green/red pair
 * (`loc-add` / `loc-del`). A zero side is left out; both zero renders nothing.
 */
export function LineStats({
  add,
  del,
  className,
}: {
  add: number;
  del: number;
  /** Layout and size only; the colours are the point. */
  className?: string;
}) {
  if (!add && !del) return null;
  return (
    <span className={cn('inline-flex gap-1 tabular-nums', className)}>
      {add ? <span className="text-loc-add">+{add}</span> : null}
      {del ? <span className="text-loc-del">−{del}</span> : null}
    </span>
  );
}
