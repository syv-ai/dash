import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PrDetails, RelevantPr } from '@shared/types';
import { groupProjectPrs, type ProjectPrGroups } from '@shared/projectPrs';
import { selectProjectHasGit, useProjects } from '../stores/projectsStore';
import { prDetailsOf, useProjectPrs, type ProjectPrListing } from '../stores/projectPrsStore';

/**
 * The project's open PRs, listed when the project is shown, grouped by where
 * you stand on them, each with the task on its head branch (see
 * `groupProjectPrs`). `groups` is null until first listed and on a forge
 * Dash has no provider for (`listing.prs` null); `reload` lists them again.
 * A plain folder (`selectProjectHasGit`) has no PRs: nothing is asked.
 */
export function useProjectPrList(projectId: string): {
  listing: ProjectPrListing | undefined;
  groups: ProjectPrGroups | null;
  reload: () => Promise<void>;
} {
  const listing = useProjectPrs((s) => s.lists[projectId]);
  const loadList = useProjectPrs((s) => s.loadList);
  const tasks = useProjects((s) => s.tasksByProject[projectId]);
  const hasGit = useProjects((s) => selectProjectHasGit(s, projectId));
  useEffect(() => {
    if (hasGit) void loadList(projectId);
  }, [projectId, hasGit, loadList]);
  const groups = useMemo(
    () => (listing?.prs ? groupProjectPrs(listing.prs, tasks ?? []) : null),
    [listing, tasks],
  );
  const reload = useCallback(() => loadList(projectId), [projectId, loadList]);
  return { listing, groups, reload };
}

/**
 * A listed PR's details (forge only, no git) while `pr` is given, as when its
 * row is expanded: fetched again once its `updatedAt` moves (see
 * `loadDetails`). `details` are the last fetched, kept through a failed
 * fetch, which `error` then names.
 */
export function usePrDetails(
  projectId: string,
  pr: Pick<RelevantPr, 'number' | 'updatedAt'> | null,
): { details: PrDetails | null; error: string | null } {
  const number = pr?.number ?? null;
  const updatedAt = pr?.updatedAt ?? null;
  const details = useProjectPrs((s) =>
    number === null ? null : prDetailsOf(projectId, number)(s),
  );
  const loadDetails = useProjectPrs((s) => s.loadDetails);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (number === null) return;
    let live = true;
    void loadDetails(projectId, number, updatedAt).then((r) => {
      if (live) setError(r.ok ? null : r.error);
    });
    return () => {
      live = false;
    };
  }, [projectId, number, updatedAt, loadDetails]);
  return { details, error };
}
