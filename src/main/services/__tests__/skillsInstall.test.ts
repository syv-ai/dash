import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';

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

import { SkillsService } from '../SkillsService';

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
    // Pre-existing install we expect to survive
    const prior = installDir();
    const fs = await import('fs');
    fs.mkdirSync(prior, { recursive: true });
    writeFileSync(path.join(prior, 'SKILL.md'), 'OLD CONTENT', 'utf-8');

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
