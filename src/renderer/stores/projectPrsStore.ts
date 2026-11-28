import { create } from 'zustand';
import type { PrDetails, RelevantPr } from '../../shared/types';

/** The store key of a project's PR. */
export const projectPrKey = (projectId: string, number: number): string => `${projectId}:${number}`;

/** A PR's details as last fetched, and the `updatedAt` its listing gave then. */
interface CachedDetails {
  updatedAt: string | null;
  details: PrDetails;
}

/** A project's open PRs as last listed (see `groupProjectPrs`). */
export interface ProjectPrListing {
  /** Newest first; null on a forge Dash has no provider for. */
  prs: RelevantPr[] | null;
  /** Why the latest listing failed, the PRs staying as listed before (none
   *  until one succeeds); null when it didn't. */
  error: string | null;
}

export type PrDetailsResult = { ok: true; details: PrDetails } | { ok: false; error: string };

interface ProjectPrsState {
  /** Per project: its open PRs as last listed. Absent until first listed. */
  lists: Record<string, ProjectPrListing>;
  /** List the project's open PRs; a listing already under way is shared. */
  loadList: (projectId: string) => Promise<void>;
  /** Per project PR (`projectPrKey`): its details as last fetched. */
  details: Record<string, CachedDetails>;
  /**
   * Fetch a project PR's details (forge only, no git), reused while its
   * listing's `updatedAt` stays the same; an `updatedAt` of null (the forge
   * didn't say) can't tell, so it fetches again. A fetch of the same PR at
   * the same `updatedAt` already under way is shared. On failure the last
   * fetched details stay.
   */
  loadDetails: (
    projectId: string,
    number: number,
    updatedAt: string | null,
  ) => Promise<PrDetailsResult>;
}

/** A selector: a project PR's details as last fetched, whatever `updatedAt`
 *  they were fetched at; null until they have been. */
export const prDetailsOf =
  (projectId: string, number: number) =>
  (s: Pick<ProjectPrsState, 'details'>): PrDetails | null =>
    s.details[projectPrKey(projectId, number)]?.details ?? null;

export const useProjectPrs = create<ProjectPrsState>((set, get) => {
  // Fetches under way, per project PR and `updatedAt`.
  const loading = new Map<string, Promise<PrDetailsResult>>();
  // The `updatedAt` last asked for, per project PR: an older answer landing
  // after a newer ask doesn't overwrite what that one fetches.
  const asked = new Map<string, string | null>();
  // Listings under way, per project.
  const listing = new Map<string, Promise<void>>();

  const putList = (projectId: string, list: ProjectPrListing) =>
    set({ lists: { ...get().lists, [projectId]: list } });

  return {
    lists: {},
    details: {},

    loadList: (projectId) => {
      const pending = listing.get(projectId);
      if (pending) return pending;
      const failed = (error: string) =>
        putList(projectId, { prs: get().lists[projectId]?.prs ?? [], error });
      const run: Promise<void> = (async () => {
        try {
          const resp = await window.electronAPI.prListProject({ projectId });
          if (resp.success) putList(projectId, { prs: resp.data ?? null, error: null });
          else failed(resp.error ?? 'unknown error');
        } catch (err) {
          failed(String(err));
        }
      })().finally(() => {
        if (listing.get(projectId) === run) listing.delete(projectId);
      });
      listing.set(projectId, run);
      return run;
    },

    loadDetails: (projectId, number, updatedAt) => {
      const key = projectPrKey(projectId, number);
      const cached = get().details[key];
      if (cached && updatedAt !== null && cached.updatedAt === updatedAt)
        return Promise.resolve({ ok: true, details: cached.details });
      const flight = `${key}\0${updatedAt ?? ''}`;
      asked.set(key, updatedAt);
      const pending = loading.get(flight);
      if (pending) return pending;
      const fetchOnce = async (): Promise<PrDetailsResult> => {
        try {
          const resp = await window.electronAPI.prDetails({ projectId, number });
          if (!resp.success || !resp.data)
            return { ok: false, error: resp.error ?? 'unknown error' };
          const details = resp.data;
          if (asked.get(key) === updatedAt)
            set({ details: { ...get().details, [key]: { updatedAt, details } } });
          return { ok: true, details };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      };
      const run: Promise<PrDetailsResult> = fetchOnce().finally(() => {
        if (loading.get(flight) === run) loading.delete(flight);
      });
      loading.set(flight, run);
      return run;
    },
  };
});
