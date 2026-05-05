import { describe, it, expect, vi } from 'vitest';
import os from 'os';
import path from 'path';

// Path validators are the entire defence between attacker-controlled registry data
// (`name`, `repo`, `path`, GitHub API `entry.name`) and arbitrary file writes anywhere
// on the user's filesystem. A regression here writes attacker bytes to ~/.ssh/authorized_keys
// or ~/.zshrc. Test the validators directly so a refactor can't quietly relax them.

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

import { assertSkillName, assertRef, resolveInstallDir, resolveChildPath } from '../SkillsService';

describe('assertSkillName', () => {
  it('accepts valid lowercase-kebab names', () => {
    expect(() => assertSkillName('pdf-extract')).not.toThrow();
    expect(() => assertSkillName('a')).not.toThrow();
    expect(() => assertSkillName('skill-1')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertSkillName('../etc/passwd')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('..')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('foo/bar')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('foo\\bar')).toThrow(/Invalid skill name/);
  });

  it('rejects null bytes and whitespace', () => {
    expect(() => assertSkillName('foo\0bar')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('foo bar')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('foo\tbar')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('foo\nbar')).toThrow(/Invalid skill name/);
  });

  it('rejects uppercase and non-ASCII', () => {
    expect(() => assertSkillName('FooBar')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('skíll')).toThrow(/Invalid skill name/);
  });

  it('rejects names that do not start with a letter or digit', () => {
    expect(() => assertSkillName('-leading-dash')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('.dotfile')).toThrow(/Invalid skill name/);
  });

  it('rejects empty and over-long names', () => {
    expect(() => assertSkillName('')).toThrow(/Invalid skill name/);
    expect(() => assertSkillName('a'.repeat(65))).toThrow(/Invalid skill name/);
  });
});

describe('assertRef', () => {
  const valid = { repo: 'owner/repo', branch: 'main', path: 'skills/foo' };

  it('accepts a valid ref', () => {
    expect(() => assertRef(valid)).not.toThrow();
  });

  it('rejects bad repos', () => {
    expect(() => assertRef({ ...valid, repo: 'no-slash' })).toThrow(/Invalid repo/);
    expect(() => assertRef({ ...valid, repo: 'a/b/c' })).toThrow(/Invalid repo/);
    expect(() => assertRef({ ...valid, repo: 'has space/repo' })).toThrow(/Invalid repo/);
    expect(() => assertRef({ ...valid, repo: 'a\0/b' })).toThrow(/Invalid repo/);
    expect(() => assertRef({ ...valid, repo: '' })).toThrow(/Invalid repo/);
  });

  it('rejects bad branches', () => {
    expect(() => assertRef({ ...valid, branch: 'bad branch' })).toThrow(/Invalid branch/);
    expect(() => assertRef({ ...valid, branch: 'has\0null' })).toThrow(/Invalid branch/);
  });

  it('rejects path traversal in path segments', () => {
    expect(() => assertRef({ ...valid, path: '../escape' })).toThrow(/Invalid skill path/);
    expect(() => assertRef({ ...valid, path: 'skills/../../etc' })).toThrow(/Invalid skill path/);
    expect(() => assertRef({ ...valid, path: 'skills/foo/..' })).toThrow(/Invalid skill path/);
  });

  it('rejects null bytes and disallowed chars in path segments', () => {
    expect(() => assertRef({ ...valid, path: 'foo\0/bar' })).toThrow(/Invalid skill path/);
    expect(() => assertRef({ ...valid, path: 'foo bar' })).toThrow(/Invalid skill path/);
    expect(() => assertRef({ ...valid, path: 'foo?bar' })).toThrow(/Invalid skill path/);
    expect(() => assertRef({ ...valid, path: 'foo#bar' })).toThrow(/Invalid skill path/);
  });
});

describe('resolveInstallDir', () => {
  it('returns a path inside the resolved base for valid inputs', () => {
    const tmp = os.tmpdir();
    const target = { kind: 'project' as const, projectPath: tmp };
    const dir = resolveInstallDir(target, 'pdf-extract');
    expect(dir).toBe(path.join(tmp, '.claude', 'skills', 'pdf-extract'));
  });

  it('rejects skill names that would escape the base via assertSkillName', () => {
    const target = { kind: 'project' as const, projectPath: os.tmpdir() };
    expect(() => resolveInstallDir(target, '../escape')).toThrow(/Invalid skill name/);
  });

  it('routes the global target to ~/.claude/skills', () => {
    const dir = resolveInstallDir({ kind: 'global' }, 'pdf-extract');
    expect(dir).toBe(path.join(os.homedir(), '.claude', 'skills', 'pdf-extract'));
  });
});

describe('resolveChildPath', () => {
  it('accepts entry names that stay inside the parent', () => {
    const base = path.join(os.tmpdir(), 'skills-test');
    expect(resolveChildPath(base, 'README.md')).toBe(path.join(base, 'README.md'));
    expect(resolveChildPath(base, 'subdir')).toBe(path.join(base, 'subdir'));
    expect(resolveChildPath(base, '.config')).toBe(path.join(base, '.config'));
  });

  it('rejects path-traversal entry names', () => {
    const base = path.join(os.tmpdir(), 'skills-test');
    // ".." passes ENTRY_NAME_RE (regex allows leading-dot tokens) but the post-resolve
    // path.relative check still catches it. Belt-and-suspenders.
    expect(() => resolveChildPath(base, '..')).toThrow(/escapes parent/);
    // A name containing a slash is caught by ENTRY_NAME_RE.
    expect(() => resolveChildPath(base, 'foo/bar')).toThrow(/Invalid file\/directory name/);
    expect(() => resolveChildPath(base, '../escape')).toThrow(/Invalid file\/directory name/);
  });

  it('rejects null bytes and whitespace', () => {
    const base = path.join(os.tmpdir(), 'skills-test');
    expect(() => resolveChildPath(base, 'foo\0bar')).toThrow(/Invalid file\/directory name/);
    expect(() => resolveChildPath(base, 'foo bar')).toThrow(/Invalid file\/directory name/);
  });
});
