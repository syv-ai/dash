import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs, realpathSync } from 'fs';
import { resolveInsideCwd } from '../editorIpc';

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// Path validation is the entire defence between renderer-controlled file paths
// and arbitrary disk writes. A regression here lets a malicious payload write
// to ~/.zshrc or ~/.ssh/authorized_keys. Test the validator in isolation so a
// refactor cannot quietly relax it.

describe('resolveInsideCwd', () => {
  const cwd = path.resolve(os.tmpdir(), 'dash-test-worktree');

  it('accepts simple relative paths', async () => {
    await fs.mkdir(cwd, { recursive: true });
    const result = resolveInsideCwd(cwd, 'src/foo.ts');
    expect(result).toBe(path.join(realpathOrSelf(cwd), 'src/foo.ts'));
  });

  it('rejects the cwd itself ("." relative path)', () => {
    expect(() => resolveInsideCwd(cwd, '.')).toThrow(/Resolved path/);
  });

  it('rejects path traversal via ..', () => {
    expect(() => resolveInsideCwd(cwd, '../escape.ts')).toThrow(/Resolved path/);
    expect(() => resolveInsideCwd(cwd, 'src/../../escape.ts')).toThrow(/Resolved path/);
  });

  it('rejects absolute paths outside the cwd', () => {
    expect(() => resolveInsideCwd(cwd, '/etc/passwd')).toThrow(/Resolved path/);
    expect(() => resolveInsideCwd(cwd, path.resolve(os.tmpdir(), 'elsewhere.ts'))).toThrow(
      /Resolved path/,
    );
  });

  it('accepts absolute paths that resolve back inside the cwd', () => {
    const inside = path.resolve(cwd, 'src/foo.ts');
    const expected = path.join(realpathOrSelf(cwd), 'src/foo.ts');
    expect(resolveInsideCwd(cwd, inside)).toBe(expected);
  });

  it('rejects null bytes', () => {
    expect(() => resolveInsideCwd(cwd, 'src/foo\0.ts')).toThrow(/null/);
  });

  it('rejects symlinks pointing outside the cwd', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'dash-symlink-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dash-outside-'));
    const outsideFile = path.join(outside, 'target.ts');
    await fs.writeFile(outsideFile, 'pwned');
    const linkPath = path.join(work, 'evil.ts');
    await fs.symlink(outsideFile, linkPath);
    expect(() => resolveInsideCwd(work, 'evil.ts')).toThrow(/symlink/);
    await fs.rm(work, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('accepts symlinks that resolve back inside the cwd', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'dash-symlink-ok-'));
    const real = path.join(work, 'real.ts');
    await fs.writeFile(real, 'ok');
    const link = path.join(work, 'link.ts');
    await fs.symlink(real, link);
    // realpath may include /private prefix on macOS; compare relatively.
    const result = resolveInsideCwd(work, 'link.ts');
    expect(path.basename(result)).toBe('real.ts');
    await fs.rm(work, { recursive: true, force: true });
  });
});
