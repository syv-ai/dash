import { CharColumn } from './CharColumn';

/** The characters each side of a column of line counts needs ("+128" is 4),
 *  so rows line up (`lineStatsColumns`). 0: no row has that side. */
export interface LineStatsColumns {
  add: number;
  del: number;
}

/** A count's width with its sign; a zero is left out, so it needs none. */
const chars = (n: number | null | undefined) => (n ? String(n).length + 1 : 0);

/** The column widths that fit every row's counts. */
export function lineStatsColumns(
  rows: Iterable<{ additions?: number | null; deletions?: number | null }>,
): LineStatsColumns {
  let add = 0;
  let del = 0;
  for (const r of rows) {
    add = Math.max(add, chars(r.additions));
    del = Math.max(del, chars(r.deletions));
  }
  return { add, del };
}

/**
 * Lines added and deleted, "+12 −3", in the app's one green/red pair
 * (`loc-add` / `loc-del`), in the surrounding text size. A zero side is left
 * out; both zero renders nothing.
 *
 * With `columns`, the two are separate right-aligned columns (`CharColumn`),
 * each as wide as the list's widest (from `lineStatsColumns`); a zero side
 * leaves its column blank, so the digits of a list line up down each column.
 */
export function LineStats({
  add,
  del,
  columns,
}: {
  add: number;
  del: number;
  columns?: LineStatsColumns;
}) {
  if (columns) {
    // Half a character over: the signs run a touch wider than a digit.
    return (
      <span className="inline-flex gap-2">
        {columns.add > 0 && (
          <CharColumn chars={columns.add + 0.5} className="text-loc-add">
            {add ? `+${add}` : null}
          </CharColumn>
        )}
        {columns.del > 0 && (
          <CharColumn chars={columns.del + 0.5} className="text-loc-del">
            {del ? `−${del}` : null}
          </CharColumn>
        )}
      </span>
    );
  }
  if (!add && !del) return null;
  return (
    <span className="inline-flex gap-1 tabular-nums">
      {add ? <span className="text-loc-add">+{add}</span> : null}
      {del ? <span className="text-loc-del">−{del}</span> : null}
    </span>
  );
}
