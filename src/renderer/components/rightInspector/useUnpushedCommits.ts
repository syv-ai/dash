import { useEffect, useState } from 'react';

const NONE: ReadonlySet<string> = new Set();

/**
 * The checkout's commits its upstream doesn't have yet, re-read whenever
 * `key` changes (the ahead count, HEAD). Empty without an upstream.
 */
export function useUnpushedCommits(cwd: string, key: unknown): ReadonlySet<string> {
  const [unpushed, setUnpushed] = useState(NONE);
  useEffect(() => {
    let live = true;
    void window.electronAPI.gitGetUpstreamCommits(cwd).then((r) => {
      if (live) setUnpushed(r.success && r.data?.unpushed.length ? new Set(r.data.unpushed) : NONE);
    });
    return () => {
      live = false;
    };
  }, [cwd, key]);
  return unpushed;
}
