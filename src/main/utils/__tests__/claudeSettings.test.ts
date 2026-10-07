import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { isWorkspaceTrusted, readClaudeSettings } from '../claudeSettings';

let tmp: string;
let repo: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

const write = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-settings-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'packages', 'web'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('readClaudeSettings', () => {
  it('lists the files in precedence, saying which the repository supplies', async () => {
    const local = path.join(repo, '.claude', 'settings.local.json');
    const shared = path.join(repo, '.claude', 'settings.json');
    const user = path.join(tmp, 'claude', 'settings.json');
    write(user, { a: 'user' });
    write(shared, { a: 'shared' });
    write(local, { a: 'local' });

    expect(await readClaudeSettings(repo, repo)).toEqual([
      { file: local, fromRepo: false, values: { a: 'local' } },
      { file: shared, fromRepo: true, values: { a: 'shared' } },
      { file: user, fromRepo: false, values: { a: 'user' } },
    ]);

    // Checked in, the local file is the repository's word, not the user's.
    execFileSync('git', ['add', '-f', local], { cwd: repo });
    expect((await readClaudeSettings(repo, repo))[0]).toMatchObject({
      file: local,
      fromRepo: true,
    });
  });

  it("reads the repository root's local file for a session started below it", async () => {
    const sub = path.join(repo, 'packages', 'web');
    const rootLocal = path.join(repo, '.claude', 'settings.local.json');
    const subLocal = path.join(sub, '.claude', 'settings.local.json');
    write(rootLocal, { a: 'root' });
    expect((await readClaudeSettings(sub, repo)).map((s) => s.file)).toEqual([rootLocal]);
    write(subLocal, { a: 'sub' });
    expect((await readClaudeSettings(sub, repo)).map((s) => s.file)).toEqual([subLocal, rootLocal]);
  });

  it('leaves out a missing file quietly and a broken one with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readClaudeSettings(repo, repo)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    write(path.join(repo, '.claude', 'settings.json'), '{ not json');
    write(path.join(tmp, 'claude', 'settings.json'), '[1]');
    expect(await readClaudeSettings(repo, repo)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('isWorkspaceTrusted', () => {
  it('is what the state file records for the repository root, and nothing else', async () => {
    expect(await isWorkspaceTrusted(repo)).toBe(false);
    write(path.join(tmp, 'claude', '.claude.json'), {
      projects: { [repo]: { hasTrustDialogAccepted: true }, [tmp]: {} },
    });
    expect(await isWorkspaceTrusted(repo)).toBe(true);
    expect(await isWorkspaceTrusted(tmp)).toBe(false);
  });
});

describe('ownership', () => {
  // Which files a session reads and what trust is are Claude Code's rules,
  // copied here once: a second copy elsewhere is one that goes stale alone.
  it('keeps settings files and the trust record out of the memory service', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'services', 'MemoryService.ts'),
      'utf8',
    );
    for (const owned of ['settings.json', 'settings.local.json', 'managed-settings', 'hasTrust']) {
      expect(source, `MemoryService names ${owned}`).not.toContain(owned);
    }
  });
});
