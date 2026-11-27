/*
 * Structural sharing for plain data, after TanStack Query's `replaceEqualDeep`.
 *
 * IPC hands the renderer a fresh copy of every object on each push (the
 * structured clone), so a store that keeps what arrived re-renders every
 * subscriber even when one entry moved. Setting `replaceEqualDeep(prev, next)`
 * instead keeps each part of `prev` that is deeply equal to its counterpart
 * in `next`: an unchanged entry keeps its identity, and so does the whole
 * value when nothing changed, so `Object.is` selectors skip the render.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `next`, reusing every part of `prev` deeply equal to it; `prev` itself when all of it is. */
export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  const arrays = Array.isArray(prev) && Array.isArray(next);
  if (!arrays && !(isPlainObject(prev) && isPlainObject(next))) return next;

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  const out: Record<string, unknown> | unknown[] = arrays ? [] : {};
  let same = Object.keys(p).length === keys.length;
  for (const key of keys) {
    const value = replaceEqualDeep(p[key], n[key]);
    (out as Record<string, unknown>)[key] = value;
    if (value !== p[key] || (value === undefined && !(key in p))) same = false;
  }
  return (same ? prev : out) as T;
}
