import type { ProjectPrGroups } from '../../../shared/projectPrs';
import { formatRelativeTime } from '../../../shared/relativeTime';
import type { RelevantPr } from '../../../shared/types';
import type { ProjectPrListing } from '../../stores/projectPrsStore';
import { plural } from '../review/labels';

/** The project page's groups of PRs, in order, as the page names them. */
export const PR_GROUPS: readonly {
  key: keyof ProjectPrGroups;
  title: string;
  /** What the group says with nothing in it. */
  empty: string;
}[] = [
  { key: 'waiting', title: 'Waiting on you', empty: 'Nothing is waiting on you.' },
  { key: 'yours', title: 'Yours', empty: 'You have no open pull requests.' },
  { key: 'others', title: 'Everyone else', empty: 'No one else has an open pull request.' },
];

/** What the Pull requests tab shows: its list, or why there is none. */
export type PrListView =
  | { kind: 'loading' }
  /** The project's forge isn't one Dash can ask. */
  | { kind: 'unsupported'; reason: string }
  /** The listing failed and nothing was listed before. */
  | { kind: 'failed'; error: string }
  | { kind: 'empty' }
  /** `error`: why the latest listing failed, the PRs staying as listed before. */
  | { kind: 'listed'; groups: ProjectPrGroups; error: string | null };

/** Why a project's PRs can't be listed: it has no remote, or one on a forge
 *  Dash has no provider for. */
export function unsupportedReason(gitRemote: string | null): string {
  return gitRemote
    ? "This project's remote isn't on GitHub or Azure DevOps, so Dash can't list its pull requests."
    : 'This project has no remote, so it has no pull requests to list.';
}

/** The tab's view of a project's listing (`useProjectPrList`). */
export function prListView(
  listing: ProjectPrListing | undefined,
  groups: ProjectPrGroups | null,
  gitRemote: string | null,
): PrListView {
  if (!listing) return { kind: 'loading' };
  if (listing.prs === null) return { kind: 'unsupported', reason: unsupportedReason(gitRemote) };
  if (listing.prs.length === 0)
    return listing.error ? { kind: 'failed', error: listing.error } : { kind: 'empty' };
  return groups ? { kind: 'listed', groups, error: listing.error } : { kind: 'loading' };
}

/** What a folded row says beside its title: its open threads (null where the
 *  forge's listing doesn't count them, ADO), and how long since it moved
 *  ('' where the listing has no update time). `now` in unix seconds. */
export interface PrRowFacts {
  openThreads: number | null;
  /** The threads' tooltip: "2 unresolved of 5 threads". */
  threadsTitle: string | null;
  updated: string;
  /** The update time's tooltip. */
  updatedTitle: string | null;
}

export function prRowFacts(pr: Pick<RelevantPr, 'threads' | 'updatedAt'>, now: number): PrRowFacts {
  const ms = pr.updatedAt ? Date.parse(pr.updatedAt) : NaN;
  const at = Number.isNaN(ms) ? 0 : ms / 1000;
  return {
    openThreads: pr.threads?.open ?? null,
    threadsTitle: pr.threads
      ? `${pr.threads.open} unresolved of ${plural(pr.threads.total, 'thread')}`
      : null,
    updated: formatRelativeTime(at, now),
    updatedTitle: at ? `Updated ${new Date(at * 1000).toLocaleString()}` : null,
  };
}

/**
 * What a row offers, by the task on its head branch (`taskForPr`): go to that
 * task, or start one from the PR (the new-task flow, prefilled); either way
 * Review goes through a task: the task's, in review mode, or a new one that
 * enters review mode once made.
 */
export type PrRowRoute =
  | { kind: 'task'; taskId: string }
  /** No task: start one from the PR. */
  | { kind: 'start' };

export const prRowRoute = (taskId: string | null): PrRowRoute =>
  taskId ? { kind: 'task', taskId } : { kind: 'start' };
