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

  it('falls back to sharded fetch when registry.json is the deprecation stub', async () => {
    // Mid-2026 upstream change: registry.json now ships only this deprecation marker
    // and the real payload lives under registry-shards/, indexed by registry-manifest.json.
    // Pre-2026 the legacy flat payload path was the only path; this test pins the
    // fallback so a future revert doesn't silently leave users on a stale cache again.
    getMetaSpy.mockReturnValue(emptyMeta());
    fetchSpy
      // 1) registry.json — deprecation stub
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deprecated_full_payload: true }), {
          status: 200,
        }) as unknown as Response,
      )
      // 2) registry-manifest.json
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            shards: [{ path: 'registry-shards/00.json' }, { path: 'registry-shards/01.json' }],
          }),
          { status: 200 },
        ) as unknown as Response,
      )
      // 3) shard 00
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            skills: [{ name: 'low', repo: 'o/r1', path: 'p1', stars: 5 }],
          }),
          { status: 200 },
        ) as unknown as Response,
      )
      // 4) shard 01
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            skills: [{ name: 'high', repo: 'o/r2', path: 'p2', stars: 999 }],
          }),
          { status: 200 },
        ) as unknown as Response,
      );
    replaceAllSpy.mockReturnValue({ inserted: 2 });

    await SkillsService.ensureRegistry(false);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // Sharded delivery is hash-bucketed, not star-sorted, so the merge step must
    // sort across the union — the "high" entry should land first regardless of shard order.
    const inserted = replaceAllSpy.mock.calls[0]?.[0] ?? [];
    expect(inserted.map((s) => s.name)).toEqual(['high', 'low']);
  });

  it('rejects a manifest with an off-base shard path', async () => {
    // Defense in depth: a compromised manifest must not be able to redirect us off
    // raw.githubusercontent.com via an absolute URL or path-traversal entry.
    getMetaSpy.mockReturnValue(emptyMeta());
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deprecated_full_payload: true }), {
          status: 200,
        }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            shards: [{ path: 'https://evil.example/steal.json' }],
          }),
          { status: 200 },
        ) as unknown as Response,
      );

    await expect(SkillsService.ensureRegistry(false)).rejects.toThrow(/Refusing shard path/);
    expect(replaceAllSpy).not.toHaveBeenCalled();
  });
});
