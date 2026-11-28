import { create } from 'zustand';
import type { PrDetails } from '../../shared/types';

/** The store key of a project's PR. */
export const projectPrKey = (projectId: string, number: number): string => `${projectId}:${number}`;

/** A PR's details as last fetched, and the `updatedAt` its listing gave then. */
interface CachedDetails {
  updatedAt: string | null;
  details: PrDetails;
}

export type PrDetailsResult = { ok: true; details: PrDetails } | { ok: false; error: string };

interface ProjectPrsState {
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

  return {
    details: {},

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
