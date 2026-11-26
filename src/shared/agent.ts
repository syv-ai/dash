import type { RepoListing } from './types';

/**
 * A task's Claude Code scratchpad, as the Agent tab shows it: the folder its
 * session writes scratch files to (main's `ScratchpadService` says which),
 * whether it is on disk, and its files.
 */
export interface TaskScratchpad {
  dir: string;
  exists: boolean;
  listing: RepoListing;
}
