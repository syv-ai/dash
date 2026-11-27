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

/** The width of one cell holding a row's whole "+12 −3", in characters, that
 *  fits every row's (`LineStats`' `width`): both counts and the space between. */
export function lineStatsWidth(
  rows: Iterable<{ additions?: number | null; deletions?: number | null }>,
): number {
  let width = 0;
  for (const r of rows) {
    const add = chars(r.additions);
    const del = chars(r.deletions);
    width = Math.max(width, add + del + (add && del ? 1 : 0));
  }
  return width;
}

/**
 * Lines added and deleted, "+12 −3", in the app's one green/red pair
 * (`loc-add` / `loc-del`), in the surrounding text size. A zero side is left
 * out; both zero renders nothing.
 *
 * With `columns`, the two are separate right-aligned columns (`CharColumn`),
 * each as wide as the list's widest (from `lineStatsColumns`); a zero side
 * leaves its column blank, so the digits of a list line up down each column.
 * With `width` instead, the pair sits together in one left-aligned cell that
 * wide (from `lineStatsWidth`), so whatever follows lines up down the list.
 */
export function LineStats({
  add,
  del,
  columns,
  width,
}: {
  add: number;
  del: number;
  columns?: LineStatsColumns;
  width?: number;
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
  if (width !== undefined) {
    if (width === 0) return null;
    // Half a character over, as the columns: the signs run wider than a digit.
    return (
      <CharColumn chars={width + 0.5} align="left">
        <Pair add={add} del={del} />
      </CharColumn>
    );
  }
  return <Pair add={add} del={del} />;
}

/** "+12 −3" inline; a zero side left out, both zero nothing. */
function Pair({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null;
  return (
    <span className="inline-flex gap-1 tabular-nums">
      {add ? <span className="text-loc-add">+{add}</span> : null}
      {del ? <span className="text-loc-del">−{del}</span> : null}
    </span>
  );
}
