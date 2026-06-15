import { useEffect, useState } from 'react';

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
}

/** Cancellable fetch keyed on `deps`. Always reflects the most recent deps;
 *  a superseded fetch is ignored. `initial` is the value before first resolve
 *  and the fallback when `enabled` is false. */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  initial: T,
  enabled = true,
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(enabled);

  useEffect(() => {
    if (!enabled) {
      setData(initial);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}
