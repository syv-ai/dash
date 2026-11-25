import type { PrListFilter, RelevantPr, RelevantPrs } from '@shared/types';

const newestFirst = (a: RelevantPr, b: RelevantPr) => b.number - a.number;

/**
 * The open PRs a branch can review (spec Revision 3): `from` it (its head)
 * and `into` it (its base), newest first. The forge already filtered by
 * branch name; this keeps exact, open matches only. A head filter matches a
 * fork's same-named branch too, which isn't this branch: such a PR is never
 * `from` it, though one into it still is.
 */
export function groupRelevantPrs(
  branch: string,
  from: readonly RelevantPr[],
  into: readonly RelevantPr[],
): RelevantPrs {
  const open = (prs: readonly RelevantPr[], ref: (p: RelevantPr) => string) =>
    prs.filter((p) => p.state === 'open' && ref(p) === branch).sort(newestFirst);
  return {
    branch,
    from: open(from, (p) => p.headRefName).filter((p) => !p.fromFork),
    into: open(into, (p) => p.baseRefName),
  };
}

/** The open PRs from and into `branch`, asked of the forge as two listings;
 *  none on a detached HEAD (null). Rejects when the forge can't be asked. */
export async function listRelevantPrs(
  list: (filter: PrListFilter) => Promise<RelevantPr[]>,
  branch: string | null,
): Promise<RelevantPrs> {
  if (!branch) return { branch: null, from: [], into: [] };
  const [from, into] = await Promise.all([list({ head: branch }), list({ base: branch })]);
  return groupRelevantPrs(branch, from, into);
}
