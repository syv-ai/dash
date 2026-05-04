import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import os from 'os';

// The stale-cache fallback in ensureRegistry exists because users were silently sitting
// on weeks-old caches when refresh broke. These tests pin that contract:
//   - fresh cache: no fetch, returns it
//   - stale cache + fetch fails: returns stale meta with refreshError, never throws
//   - empty cache + fetch fails: throws (so the modal can't show an empty browser silently)
//   - forceRefresh: bypasses TTL even when fresh

vi.mock('electron', () => ({
  default: {},
  app: { getPath: () => os.tmpdir() },
}));
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => ({ get: () => undefined, all: () => [], run: vi.fn() })),
    transaction: (fn: (...args: unknown[]) => unknown) => fn,
    close: vi.fn(),
  })),
}));

import { SkillsService } from '../SkillsService';
import { SkillsCache } from '../skillsCache';

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

let fetchSpy: MockInstance<typeof globalThis.fetch>;
let getMetaSpy: MockInstance<typeof SkillsCache.getMeta>;
let replaceAllSpy: MockInstance<typeof SkillsCache.replaceAll>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  getMetaSpy = vi.spyOn(SkillsCache, 'getMeta');
  replaceAllSpy = vi.spyOn(SkillsCache, 'replaceAll');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function freshMeta() {
  return { status: 'fresh' as const, fetchedAt: Date.now() - ONE_HOUR, totalCount: 100 };
}
function staleMeta() {
  return { status: 'fresh' as const, fetchedAt: Date.now() - 2 * ONE_DAY, totalCount: 100 };
}
function emptyMeta() {
  return { status: 'never-fetched' as const, fetchedAt: null, totalCount: 0 as const };
}

function mockRegistryFetch(payload: { skills: unknown[] }) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify(payload), { status: 200 }) as unknown as Response,
  );
}

function mockRegistryFetchFailure() {
  fetchSpy.mockRejectedValueOnce(new Error('network down'));
}

describe('ensureRegistry', () => {
  it('short-circuits when cache is fresh and not forced', async () => {
    getMetaSpy.mockReturnValue(freshMeta());

    const meta = await SkillsService.ensureRegistry(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replaceAllSpy).not.toHaveBeenCalled();
    expect(meta.totalCount).toBe(100);
  });

  it('refetches when forceRefresh is true even if cache is fresh', async () => {
    getMetaSpy.mockReturnValue(freshMeta());
    mockRegistryFetch({
      skills: [{ name: 'a', repo: 'o/r', path: 'p' }],
    });
    replaceAllSpy.mockReturnValue({ inserted: 1 });

    await SkillsService.ensureRegistry(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(replaceAllSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when cache is older than CACHE_TTL_MS', async () => {
    getMetaSpy.mockReturnValue(staleMeta());
    mockRegistryFetch({ skills: [{ name: 'a', repo: 'o/r', path: 'p' }] });
    replaceAllSpy.mockReturnValue({ inserted: 1 });

    await SkillsService.ensureRegistry(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when cache is empty', async () => {
    getMetaSpy.mockReturnValue(emptyMeta());
    mockRegistryFetch({ skills: [{ name: 'a', repo: 'o/r', path: 'p' }] });
    replaceAllSpy.mockReturnValue({ inserted: 1 });

    await SkillsService.ensureRegistry(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns stale meta with refreshError when fetch fails but cache is non-empty', async () => {
    const stale = staleMeta();
    getMetaSpy.mockReturnValue(stale);
    mockRegistryFetchFailure();

    const meta = await SkillsService.ensureRegistry(false);

    expect(meta.status).toBe('stale');
    expect(meta.totalCount).toBe(stale.totalCount);
    expect(meta.fetchedAt).toBe(stale.fetchedAt);
    if (meta.status === 'stale') {
      expect(meta.refreshError).toContain('network down');
    }
  });

  it('throws when fetch fails AND the cache is empty', async () => {
    getMetaSpy.mockReturnValue(emptyMeta());
    mockRegistryFetchFailure();

    await expect(SkillsService.ensureRegistry(false)).rejects.toThrow(/network down/);
  });

  it('throws when registry parses but yields zero valid skills', async () => {
    getMetaSpy.mockReturnValue(emptyMeta());
    // Registry returns rows that all fail normalization (no name/repo/path).
    mockRegistryFetch({ skills: [{}, {}, { foo: 'bar' }] });

    await expect(SkillsService.ensureRegistry(false)).rejects.toThrow(/0 valid skills/);
    expect(replaceAllSpy).not.toHaveBeenCalled();
  });
});
