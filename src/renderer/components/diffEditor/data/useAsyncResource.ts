import { useEffect, useRef, useState } from 'react';

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  /** `data` answers the current deps: false from the render the deps change
   *  in (before `loading` turns on) until their fetch settles. */
  settled: boolean;
}

/** Cancellable fetch keyed on `deps`. Always reflects the most recent deps;
 *  a superseded fetch is ignored. `initial` is the value before first resolve
 *  and the fallback when `enabled` is false. A new `refresh` fetches the same
 *  deps again in the background: the old data stays, and it neither loads nor
 *  unsettles. */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  initial: T,
  enabled = true,
  refresh = 0,
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(enabled);
  const key = JSON.stringify(deps);
  const [settledFor, setSettledFor] = useState<string | null>(null);
  /** The deps the last fetch ran for: the same again is a refresh. */
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      fetchedFor.current = null;
      setData(initial);
      setLoading(false);
      setSettledFor(key);
      return;
    }
    let cancelled = false;
    const background = fetchedFor.current === key;
    fetchedFor.current = key;
    if (!background) setLoading(true);
    void fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setSettledFor(key);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refresh]);

  return { data, loading, settled: !loading && settledFor === key };
}
