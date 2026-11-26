import type { RepoListing } from './types';

/**
 * A task's Claude Code scratchpad, as the Agent tab shows it: the session's
 * folder (the last one a payload named, else derived from the task's session),
 * whether it is on disk, and its files.
 */
export interface TaskScratchpad {
  dir: string;
  exists: boolean;
  listing: RepoListing;
}
