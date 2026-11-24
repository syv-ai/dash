import { useEffect, useState } from 'react';
import type { CommitLinks } from '../../../shared/types';

const NONE: CommitLinks = { commitUrl: null, authorUrl: null };

/** A commit's forge links (its page once pushed, its author's profile where
 *  the forge knows it), fetched once `enabled` (a card opened). */
export function useCommitLinks(cwd: string, hash: string, enabled: boolean): CommitLinks {
  const [links, setLinks] = useState<CommitLinks>(NONE);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window.electronAPI.gitCommitLinks({ cwd, hash }).then((r) => {
      if (live) setLinks(r.success && r.data ? r.data : NONE);
    });
    return () => {
      live = false;
    };
  }, [cwd, hash, enabled]);
  return links;
}
