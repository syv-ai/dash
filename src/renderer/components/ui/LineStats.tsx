/**
 * Lines added and deleted, "+12 −3", in the app's one green/red pair
 * (`loc-add` / `loc-del`), in the surrounding text size. A zero side is left
 * out; both zero renders nothing.
 */
export function LineStats({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null;
  return (
    <span className="inline-flex gap-1 tabular-nums">
      {add ? <span className="text-loc-add">+{add}</span> : null}
      {del ? <span className="text-loc-del">−{del}</span> : null}
    </span>
  );
}
