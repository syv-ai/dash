import type { RepoListing } from './types';

/**
 * A task's Claude Code scratchpad, as the Agent tab shows it: the folder its
 * session writes scratch files to (main's `ScratchpadService` says which),
 * whose folder it is, whether it is on disk, and its files.
 */
export interface TaskScratchpad {
  dir: string;
  /** The background job whose `tmp/` it is; null for the session's own
   *  scratchpad in the system temp folder (the task has no job). */
  jobId: string | null;
  exists: boolean;
  listing: RepoListing;
}
