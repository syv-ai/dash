import { useEffect, useRef, useState } from 'react';

/** Returns a nonce that bumps once the new file's content has actually loaded
 *  (not on the click), so the viewport fade coincides with the visual swap
 *  rather than fading the OLD content in. */
export function useFileFade(filePath: string, isLoaded: boolean): number {
  const pending = useRef(false);
  const [nonce, setNonce] = useState(0);

  // Mark a fade as pending whenever the user switches files. We don't run it
  // here — we wait for the new content to actually load (below).
  useEffect(() => {
    pending.current = true;
  }, [filePath]);

  // Fire the fade once `loaded` arrives for the pending file change.
  useEffect(() => {
    if (!isLoaded || !pending.current) return;
    pending.current = false;
    setNonce((n) => n + 1);
  }, [isLoaded]);

  return nonce;
}
