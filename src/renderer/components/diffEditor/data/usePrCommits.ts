import type { CommitSummary } from '../types';
import { useAsyncResource } from './useAsyncResource';
import { listCommits } from './useEditorViewData';

/** A PR's commits, base..head (both in the checkout), newest first. */
export interface PrCommitsRange {
  number: number;
  base: string;
  head: string;
}

const NONE: CommitSummary[] = [];
/** More than History's usual 50: a PR's commits are listed whole up to here. */
const PR_COMMITS_LIMIT = 250;

/** The commits of `range` at `cwd`; idle (none) without one. */
export function usePrCommits(
  cwd: string,
  range: PrCommitsRange | null,
): { commits: CommitSummary[]; loading: boolean } {
  const { data, loading } = useAsyncResource(
    () => (range ? listCommits(cwd, PR_COMMITS_LIMIT, range) : Promise.resolve(NONE)),
    [cwd, range?.base, range?.head],
    NONE,
    range !== null,
  );
  return { commits: data, loading };
}
