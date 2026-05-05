import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import os from 'os';
import path from 'path';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from 'fs';

// Verifies the install pipeline's load-bearing invariants:
//   - atomic staging swap (mid-install failures don't leave half-installed skills)
//   - file-count and file-size caps actually abort the install
//   - non-raw.githubusercontent.com download URLs are refused
//   - SKILL.md path traversal is rejected even if the registry returns it

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

import { createHash } from 'crypto';
import { SkillsService } from '../SkillsService';
import { SkillsCache } from '../skillsCache';
import type { RegistrySkill } from '@shared/types';

const RAW = 'https://raw.githubusercontent.com';
const validRef = { repo: 'owner/repo', branch: 'main', path: 'skills/demo' };

interface FetchStub {
  status?: number;
  body: string;
  headers?: Record<string, string>;
}

let tmpRoot: string;
let fetchSpy: MockInstance<typeof globalThis.fetch>;
let routes: Array<{ match: (url: string) => boolean; respond: () => FetchStub }>;

function projectTarget() {
  return { kind: 'project' as const, projectPath: tmpRoot };
}

function installDir() {
  return path.join(tmpRoot, '.claude', 'skills', 'demo');
}

function skillsParent() {
  return path.join(tmpRoot, '.claude', 'skills');
}

function setRoute(match: (url: string) => boolean, respond: () => FetchStub) {
  routes.unshift({ match, respond });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'dash-skills-test-'));
  routes = [];
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
    const route = routes.find((r) => r.match(url));
    if (!route) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const stub = route.respond();
    return new Response(stub.body, {
      status: stub.status ?? 200,
      statusText: stub.status === 200 || !stub.status ? 'OK' : 'ERR',
      headers: stub.headers,
    });
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('installSkill — happy path', () => {
  it('writes SKILL.md and any sibling files atomically into the install dir', async () => {
    setRoute(
      (u) => u.startsWith(`${RAW}/owner/repo/main/skills/demo/SKILL.md`),
      () => ({ body: '# Demo skill' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/repos/owner/repo/contents/skills/demo'),
      () => ({
        body: JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/SKILL.md`,
          },
          {
            name: 'helper.md',
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/helper.md`,
            size: 100,
          },
        ]),
      }),
    );
    setRoute(
      (u) => u.startsWith(`${RAW}/owner/repo/main/skills/demo/helper.md`),
      () => ({ body: '## Helper' }),
    );

    await SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() });

    expect(existsSync(installDir())).toBe(true);
    expect(readFileSync(path.join(installDir(), 'SKILL.md'), 'utf-8')).toBe('# Demo skill');
    expect(readFileSync(path.join(installDir(), 'helper.md'), 'utf-8')).toBe('## Helper');
    expect(readdirSync(skillsParent()).filter((n) => n.includes('.tmp-'))).toHaveLength(0);
  });
});

describe('installSkill — staging cleanup on failure', () => {
  it('removes the staging dir and preserves a prior install when the SKILL.md fetch fails', async () => {
    // Pre-existing install we expect to survive. Tag it with a Dash marker so the
    // install precondition allows the swap path to be exercised — without a marker
    // the install would refuse before any fetch happens (covered separately below).
    const prior = installDir();
    mkdirSync(prior, { recursive: true });
    writeFileSync(path.join(prior, 'SKILL.md'), 'OLD CONTENT', 'utf-8');
    writeFileSync(
      path.join(prior, '.dash-skill.json'),
      JSON.stringify({
        version: 1,
        repo: 'owner/repo',
        branch: 'main',
        path: 'skills/demo',
        installedAt: 0,
      }),
      'utf-8',
    );

    setRoute(
      (u) => u.includes('/SKILL.md'),
      () => ({ status: 500, body: 'oops' }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow();

    // Prior install survives — staging swap never happened.
    expect(readFileSync(path.join(prior, 'SKILL.md'), 'utf-8')).toBe('OLD CONTENT');
    // No leftover staging dirs
    expect(readdirSync(skillsParent()).filter((n) => n.includes('.tmp-'))).toHaveLength(0);
  });

  it('removes the staging dir when a sibling fetch fails after SKILL.md succeeded', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({
        body: JSON.stringify([
          {
            name: 'helper.md',
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/helper.md`,
          },
        ]),
      }),
    );
    setRoute(
      (u) => u.endsWith('/helper.md'),
      () => ({ status: 503, body: 'service unavailable' }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow();

    expect(existsSync(installDir())).toBe(false);
    expect(readdirSync(skillsParent()).filter((n) => n.includes('.tmp-'))).toHaveLength(0);
  });
});

describe('installSkill — security guards', () => {
  it('refuses non-raw.githubusercontent.com download URLs', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({
        body: JSON.stringify([
          {
            name: 'evil.md',
            type: 'file',
            // Different host — must be refused
            download_url: 'https://attacker.example.com/payload.md',
          },
        ]),
      }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/non-GitHub download URL/);
    expect(existsSync(installDir())).toBe(false);
  });

  it('rejects entry names that would escape the install dir', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({
        body: JSON.stringify([
          {
            name: '../evil.md',
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/evil.md`,
          },
        ]),
      }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/Invalid file\/directory name/);
  });

  it('aborts when an entry reports size > MAX_FILE_BYTES', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({
        body: JSON.stringify([
          {
            name: 'huge.md',
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/huge.md`,
            size: 10 * 1024 * 1024,
          },
        ]),
      }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/exceeds max size/);
  });

  it('aborts when a directory contains more than MAX_FILES_PER_SKILL files', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({
        body: JSON.stringify(
          Array.from({ length: 60 }, (_, i) => ({
            name: `f${i}.md`,
            type: 'file',
            download_url: `${RAW}/owner/repo/main/skills/demo/f${i}.md`,
          })),
        ),
      }),
    );
    setRoute(
      (u) => /\/f\d+\.md$/.test(u),
      () => ({ body: 'x' }),
    );

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/exceeds max files/);
  });

  it('rejects invalid skill names before any fetch', async () => {
    await expect(
      SkillsService.installSkill({
        ref: validRef,
        skillName: '../evil',
        target: projectTarget(),
      }),
    ).rejects.toThrow(/Invalid skill name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an in-flight install of the same skill', async () => {
    let resolveSkill: (() => void) | null = null;
    const skillBlocked = new Promise<void>((r) => {
      resolveSkill = r;
    });

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({ body: JSON.stringify([]) }),
    );

    // Block the SKILL.md fetch by hijacking the implementation for this test only.
    fetchSpy.mockImplementationOnce(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
      if (url.endsWith('/SKILL.md')) {
        await skillBlocked;
        return new Response('# Demo', { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const first = SkillsService.installSkill({
      ref: validRef,
      skillName: 'demo',
      target: projectTarget(),
    });

    // Second install for the SAME (skill, target) should be rejected immediately.
    await expect(
      SkillsService.installSkill({
        ref: validRef,
        skillName: 'demo',
        target: projectTarget(),
      }),
    ).rejects.toThrow(/already in progress/);

    resolveSkill!();
    await first;
  });
});

describe('installSkill — marker / custom-skill protection', () => {
  it('refuses to overwrite an existing dir that has no Dash marker', async () => {
    // User's pre-existing custom skill: a SKILL.md, no marker file.
    const prior = installDir();
    mkdirSync(prior, { recursive: true });
    writeFileSync(path.join(prior, 'SKILL.md'), 'CUSTOM USER CONTENT', 'utf-8');

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/not installed by Dash/);

    // The user's data must survive untouched.
    expect(readFileSync(path.join(prior, 'SKILL.md'), 'utf-8')).toBe('CUSTOM USER CONTENT');
    // No fetches should have happened — we refused before any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('writes a marker carrying the registry coordinates after a successful install', async () => {
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({ body: JSON.stringify([]) }),
    );

    await SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() });

    const markerText = readFileSync(path.join(installDir(), '.dash-skill.json'), 'utf-8');
    const marker = JSON.parse(markerText);
    expect(marker.version).toBe(1);
    expect(marker.repo).toBe(validRef.repo);
    expect(marker.path).toBe(validRef.path);
    expect(marker.branch).toBe(validRef.branch);
    expect(typeof marker.installedAt).toBe('number');
  });

  it('allows reinstalling over an existing Dash install (marker present)', async () => {
    const prior = installDir();
    mkdirSync(prior, { recursive: true });
    writeFileSync(path.join(prior, 'SKILL.md'), 'OLD', 'utf-8');
    writeFileSync(
      path.join(prior, '.dash-skill.json'),
      JSON.stringify({
        version: 1,
        repo: 'owner/repo',
        branch: 'main',
        path: 'skills/demo',
        installedAt: 0,
      }),
      'utf-8',
    );

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# NEW' }),
    );
    setRoute(
      (u) => u.startsWith('https://api.github.com/'),
      () => ({ body: JSON.stringify([]) }),
    );

    await SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() });

    expect(readFileSync(path.join(installDir(), 'SKILL.md'), 'utf-8')).toBe('# NEW');
    // Fresh marker should have been written (installedAt > 0).
    const marker = JSON.parse(readFileSync(path.join(installDir(), '.dash-skill.json'), 'utf-8'));
    expect(marker.installedAt).toBeGreaterThan(0);
  });
});

describe('checkInstalled — marker matching', () => {
  function setupCustomSkill() {
    // Mimic the user's custom skill: bare SKILL.md, no marker, in the project's scope.
    const customDir = path.join(tmpRoot, '.claude', 'skills', 'validate');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(path.join(customDir, 'SKILL.md'), '# User custom validate', 'utf-8');
    return customDir;
  }

  it('does NOT report a registry skill as installed when a same-named custom folder exists', () => {
    setupCustomSkill();

    const status = SkillsService.checkInstalled(
      'validate',
      [tmpRoot],
      // Registry coordinates for some "validate" skill from anywhere
      { repo: 'someone/skills', branch: 'main', path: 'skills/validate' },
    );

    expect(status.global).toBe(false);
    expect(status.installedPaths).toEqual([]);
  });

  it('reports a registry skill as installed when the marker matches the ref', () => {
    const dir = path.join(tmpRoot, '.claude', 'skills', 'validate');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# Registry', 'utf-8');
    writeFileSync(
      path.join(dir, '.dash-skill.json'),
      JSON.stringify({
        version: 1,
        repo: 'someone/skills',
        branch: 'main',
        path: 'skills/validate',
        installedAt: 1,
      }),
      'utf-8',
    );

    const status = SkillsService.checkInstalled('validate', [tmpRoot], {
      repo: 'someone/skills',
      branch: 'main',
      path: 'skills/validate',
    });

    expect(status.installedPaths).toEqual([tmpRoot]);
  });

  it('does NOT report installed when the marker is for a different registry skill', () => {
    const dir = path.join(tmpRoot, '.claude', 'skills', 'validate');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# Different', 'utf-8');
    writeFileSync(
      path.join(dir, '.dash-skill.json'),
      JSON.stringify({
        version: 1,
        repo: 'other/skills',
        branch: 'main',
        path: 'skills/validate',
        installedAt: 1,
      }),
      'utf-8',
    );

    const status = SkillsService.checkInstalled('validate', [tmpRoot], {
      repo: 'someone/skills',
      branch: 'main',
      path: 'skills/validate',
    });

    expect(status.installedPaths).toEqual([]);
  });

  it('falls back to presence-only when no ref is provided (legacy callers)', () => {
    setupCustomSkill();

    const status = SkillsService.checkInstalled('validate', [tmpRoot]);

    expect(status.installedPaths).toEqual([tmpRoot]);
  });
});

describe('listInstalled — externally-installed registry skills', () => {
  function stubCatalog(skills: RegistrySkill[]) {
    return vi.spyOn(SkillsCache, 'allSkills').mockReturnValue(skills);
  }

  function makeRegistrySkill(over: Partial<RegistrySkill> = {}): RegistrySkill {
    return {
      name: 'demo',
      description: '',
      repo: 'someone/skills',
      path: 'skills/demo',
      branch: 'main',
      category: '',
      tags: [],
      stars: 0,
      ...over,
    };
  }

  function externalInstall(folderName: string, content: string) {
    const dir = path.join(tmpRoot, '.claude', 'skills', folderName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
    return dir;
  }

  function sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  it('binds the marker when SKILL.md byte-matches the unique registry candidate', async () => {
    stubCatalog([makeRegistrySkill({ name: 'demo' })]);
    const dir = externalInstall('demo', '# Demo content');

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Demo content' }),
    );

    const result = await SkillsService.listInstalled([tmpRoot]);

    const marker = JSON.parse(readFileSync(path.join(dir, '.dash-skill.json'), 'utf-8'));
    expect(marker.repo).toBe('someone/skills');
    expect(marker.path).toBe('skills/demo');
    expect(result.skills[0].catalog?.repo).toBe('someone/skills');
    // No verified-custom sentinel when we bound successfully.
    expect(existsSync(path.join(dir, '.dash-skill-checked.json'))).toBe(false);
  });

  it('writes a verified-custom sentinel keyed by content hash on no-match', async () => {
    stubCatalog([makeRegistrySkill({ name: 'demo' })]);
    const localContent = '# I edited this';
    const dir = externalInstall('demo', localContent);

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# Different upstream content' }),
    );

    const result = await SkillsService.listInstalled([tmpRoot]);

    expect(existsSync(path.join(dir, '.dash-skill.json'))).toBe(false);
    expect(result.skills[0].catalog).toBeNull();

    const sentinel = JSON.parse(readFileSync(path.join(dir, '.dash-skill-checked.json'), 'utf-8'));
    expect(sentinel.contentSha256).toBe(sha256(localContent));
  });

  it('skips the fetch on later listInstalled calls when the sentinel hash still matches', async () => {
    stubCatalog([makeRegistrySkill({ name: 'demo' })]);
    externalInstall('demo', '# user custom');

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# different upstream' }),
    );

    await SkillsService.listInstalled([tmpRoot]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call must NOT refetch — sentinel says we already checked this content.
    fetchSpy.mockClear();
    await SkillsService.listInstalled([tmpRoot]);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('re-checks when the user has edited the local SKILL.md since the sentinel was written', async () => {
    stubCatalog([makeRegistrySkill({ name: 'demo' })]);
    const dir = externalInstall('demo', '# v1 user content');

    // First pass: registry returns something different → sentinel written for v1 hash.
    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# upstream' }),
    );
    await SkillsService.listInstalled([tmpRoot]);
    expect(existsSync(path.join(dir, '.dash-skill-checked.json'))).toBe(true);

    // User edits the file. Sentinel hash no longer matches local content.
    writeFileSync(path.join(dir, 'SKILL.md'), '# upstream', 'utf-8');

    // Second pass: registry happens to match the new local content → bind.
    fetchSpy.mockClear();
    await SkillsService.listInstalled([tmpRoot]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(dir, '.dash-skill.json'))).toBe(true);
  });

  it('does not bind when multiple registry skills derive to the same name', async () => {
    stubCatalog([
      makeRegistrySkill({ repo: 'one/skills', path: 'skills/demo' }),
      makeRegistrySkill({ repo: 'two/skills', path: 'demo' }),
    ]);
    const dir = externalInstall('demo', 'whatever');

    const result = await SkillsService.listInstalled([tmpRoot]);

    expect(existsSync(path.join(dir, '.dash-skill.json'))).toBe(false);
    expect(existsSync(path.join(dir, '.dash-skill-checked.json'))).toBe(false);
    expect(result.skills[0].catalog).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not bind or fetch when no registry candidate matches the folder name', async () => {
    stubCatalog([makeRegistrySkill({ name: 'pdf-extract' })]);
    const dir = externalInstall('validate', '# user custom');

    const result = await SkillsService.listInstalled([tmpRoot]);

    expect(existsSync(path.join(dir, '.dash-skill.json'))).toBe(false);
    expect(existsSync(path.join(dir, '.dash-skill-checked.json'))).toBe(false);
    expect(result.skills[0].catalog).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Marker corruption is its own failure mode: ENOENT means "user's custom skill", but a
// truncated/parse-failing/version-mismatched marker means "Dash install gone wrong".
// The earlier null-on-any-failure shape collapsed the two, leading to contradictory UX
// (checkInstalled said "not installed" but installSkill refused with "already exists").
describe('installSkill — corrupt marker handling', () => {
  function writeMarker(skillDir: string, raw: string) {
    writeFileSync(path.join(skillDir, '.dash-skill.json'), raw, 'utf-8');
  }

  it.each([
    ['truncated json', 'not-json'],
    ['version mismatch', JSON.stringify({ version: 999, repo: 'a/b', branch: 'main', path: 'p' })],
    [
      'missing field',
      JSON.stringify({ version: 1, repo: 'a/b', branch: 'main' /* path missing */ }),
    ],
  ])('rejects install with a clear message when marker is %s', async (_label, body) => {
    const prior = installDir();
    mkdirSync(prior, { recursive: true });
    writeFileSync(path.join(prior, 'SKILL.md'), 'OLD', 'utf-8');
    writeMarker(prior, body);

    await expect(
      SkillsService.installSkill({ ref: validRef, skillName: 'demo', target: projectTarget() }),
    ).rejects.toThrow(/marker.*corrupt|Click Uninstall/i);

    // Untouched: the precondition aborted before the staging swap.
    expect(readFileSync(path.join(prior, 'SKILL.md'), 'utf-8')).toBe('OLD');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('checkInstalled — corrupt marker surfaces probe failure', () => {
  it('reports marker-corrupt when the ref is supplied and the marker is unparseable', () => {
    const dir = path.join(tmpRoot, '.claude', 'skills', 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# whatever', 'utf-8');
    writeFileSync(path.join(dir, '.dash-skill.json'), 'not-json', 'utf-8');

    const status = SkillsService.checkInstalled('demo', [tmpRoot], {
      repo: 'owner/repo',
      branch: 'main',
      path: 'skills/demo',
    });

    expect(status.installedPaths).toEqual([]);
    expect(status.probeFailures).toBeDefined();
    expect(status.probeFailures?.[0]).toMatchObject({
      scope: 'path',
      path: tmpRoot,
      code: 'marker-corrupt',
    });
  });

  it('reports marker-corrupt under global scope when the global marker is bad', () => {
    // Drive the home dir to tmpRoot so we don't touch the real user's filesystem.
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot);
    try {
      const dir = path.join(tmpRoot, '.claude', 'skills', 'demo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'SKILL.md'), '# whatever', 'utf-8');
      writeFileSync(
        path.join(dir, '.dash-skill.json'),
        JSON.stringify({ version: 99, repo: 'a/b', branch: 'main', path: 'p' }),
        'utf-8',
      );

      const status = SkillsService.checkInstalled('demo', [], {
        repo: 'owner/repo',
        branch: 'main',
        path: 'skills/demo',
      });

      expect(status.global).toBe(false);
      expect(status.probeFailures?.[0]).toEqual({ scope: 'global', code: 'marker-corrupt' });
    } finally {
      homeSpy.mockRestore();
    }
  });
});

describe('listInstalled — corrupt sentinel re-fetches and rewrites', () => {
  function stubCatalog(skills: RegistrySkill[]) {
    return vi.spyOn(SkillsCache, 'allSkills').mockReturnValue(skills);
  }

  function makeRegistrySkill(over: Partial<RegistrySkill> = {}): RegistrySkill {
    return {
      name: 'demo',
      description: '',
      repo: 'someone/skills',
      path: 'skills/demo',
      branch: 'main',
      category: '',
      tags: [],
      stars: 0,
      ...over,
    };
  }

  it('re-checks an orphan with an unparseable sentinel and rewrites it', async () => {
    stubCatalog([makeRegistrySkill({ name: 'demo' })]);
    const dir = path.join(tmpRoot, '.claude', 'skills', 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# user custom', 'utf-8');
    writeFileSync(path.join(dir, '.dash-skill-checked.json'), 'broken-sentinel{', 'utf-8');

    setRoute(
      (u) => u.endsWith('/SKILL.md'),
      () => ({ body: '# upstream different' }),
    );

    await SkillsService.listInstalled([tmpRoot]);

    // The sentinel was unreadable, so we should have re-fetched and rewritten it.
    expect(fetchSpy).toHaveBeenCalled();
    const sentinel = JSON.parse(readFileSync(path.join(dir, '.dash-skill-checked.json'), 'utf-8'));
    expect(sentinel.version).toBe(1);
    expect(typeof sentinel.contentSha256).toBe('string');
  });

  it('one slow/failing skill does not blank the entire installed list', async () => {
    // Two distinct catalog entries → two parallel orphans. The first errors mid-fetch;
    // the second must still complete and its row must come back bound.
    // Drive home to tmpRoot so we don't pick up the developer's real ~/.claude/skills.
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot);
    try {
      stubCatalog([
        makeRegistrySkill({ name: 'demo', path: 'skills/demo' }),
        makeRegistrySkill({ name: 'other', repo: 'someone/skills', path: 'skills/other' }),
      ]);
      const demoDir = path.join(tmpRoot, '.claude', 'skills', 'demo');
      const otherDir = path.join(tmpRoot, '.claude', 'skills', 'other');
      mkdirSync(demoDir, { recursive: true });
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(path.join(demoDir, 'SKILL.md'), '# demo content', 'utf-8');
      writeFileSync(path.join(otherDir, 'SKILL.md'), '# other content', 'utf-8');

      setRoute(
        (u) => u.includes('skills/demo/SKILL.md'),
        () => ({ status: 503, body: 'oops' }),
      );
      setRoute(
        (u) => u.includes('skills/other/SKILL.md'),
        () => ({ body: '# other content' }),
      );

      // Pass tmpRoot as a project probe AND lean on the homedir mock for global probe —
      // both rows show up but without the user's real installed skills bleeding in.
      const result = await SkillsService.listInstalled([tmpRoot]);

      // Both skills appear in the result; the failing one falls through to Custom.
      const demo = result.skills.find((s) => s.skillName === 'demo');
      const other = result.skills.find((s) => s.skillName === 'other');
      expect(demo).toBeDefined();
      expect(other).toBeDefined();
      expect(other?.catalog?.repo).toBe('someone/skills');
      // Marker present for the one that succeeded.
      expect(existsSync(path.join(otherDir, '.dash-skill.json'))).toBe(true);
    } finally {
      homeSpy.mockRestore();
    }
  });
});
