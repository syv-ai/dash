import { execFileSync } from 'child_process';
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claudeConfigDir,
  claudeProjectDir,
  claudeSkillsDir,
  claudeStateFile,
  claudeUserSettingsFile,
  isWorkspaceTrusted,
  encodeProjectPath,
} from '../claudePaths';

describe('encodeProjectPath', () => {
  // Real directory names Claude Code 2.1.282 created under ~/.claude/projects.
  it.each([
    [
      '/home/fabian-scott/Documents/Git-Projects/dash',
      '-home-fabian-scott-Documents-Git-Projects-dash',
    ],
    [
      '/home/fabian-scott/Documents/Git-Projects/dash/.claude/worktrees/claude-s-memories-f6c',
      '-home-fabian-scott-Documents-Git-Projects-dash--claude-worktrees-claude-s-memories-f6c',
    ],
  ])('encodes %s like Claude Code', (input, expected) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });

  it('hyphenates every non-alphanumeric character, on every platform', () => {
    expect(encodeProjectPath('/tmp/a:b_c d.e')).toBe('-tmp-a-b-c-d-e');
    expect(encodeProjectPath('C:\\Users\\foo')).toBe('C--Users-foo');
  });

  it('truncates names over 200 chars and appends a base36 hash of the raw path', () => {
    const long = '/home/u/' + 'very-long-directory-name/'.repeat(9) + 'repo';
    expect(encodeProjectPath(long)).toBe(
      '-home-u-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directo-xabdzz',
    );
  });

  it('leaves names of exactly 200 chars untouched', () => {
    const p = '/' + 'a'.repeat(199);
    expect(encodeProjectPath(p)).toBe('-' + 'a'.repeat(199));
  });
});

describe('claudeConfigDir / claudeProjectDir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalName = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    if (originalName === undefined) delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
    else process.env.CLAUDE_CODE_PROJECT_DIR_NAME = originalName;
  });

  it('uses CLAUDE_CODE_PROJECT_DIR_NAME for every cwd, beside a custom config dir only', () => {
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'work';
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeProjectDir('/repo')).toBe(path.join(os.homedir(), '.claude', 'projects', '-repo'));

    process.env.CLAUDE_CONFIG_DIR = '/srv/tenant-a';
    expect(claudeProjectDir('/repo')).toBe('/srv/tenant-a/projects/work');
    expect(claudeProjectDir('/elsewhere')).toBe('/srv/tenant-a/projects/work');
  });

  it.each(['', 'has space', '../up', 'con', 'a'.repeat(65)])(
    'ignores the project dir name %j, as Claude Code does',
    (name) => {
      process.env.CLAUDE_CONFIG_DIR = '/srv/tenant-a';
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = name;
      expect(claudeProjectDir('/repo')).toBe('/srv/tenant-a/projects/-repo');
    },
  );

  it('keeps its state file beside a custom config dir, else in the home directory', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeStateFile()).toBe(path.join(os.homedir(), '.claude.json'));
    process.env.CLAUDE_CONFIG_DIR = '/srv/tenant-a';
    expect(claudeStateFile()).toBe('/srv/tenant-a/.claude.json');
  });

  it('defaults to ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('honours CLAUDE_CONFIG_DIR, treating empty as unset', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeConfigDir()).toBe('/tmp/alt-claude');
    process.env.CLAUDE_CONFIG_DIR = '';
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('places a cwd under <config dir>/projects/<encoded>', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeProjectDir('/repo/.claude/worktrees/x')).toBe(
      '/tmp/alt-claude/projects/-repo--claude-worktrees-x',
    );
  });

  it('places global skills and user settings under the config dir', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeSkillsDir()).toBe('/tmp/alt-claude/skills');
    expect(claudeUserSettingsFile()).toBe('/tmp/alt-claude/settings.json');
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeSkillsDir()).toBe(path.join(os.homedir(), '.claude', 'skills'));
  });
});

describe('isWorkspaceTrusted', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  it('reads the trust flag Claude Code records per root', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-trust-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        projects: { '/repo/a': { hasTrustDialogAccepted: true }, '/repo/b': {} },
      }),
    );
    expect(await isWorkspaceTrusted('/repo/a')).toBe(true);
    expect(await isWorkspaceTrusted('/repo/b')).toBe(false);
    expect(await isWorkspaceTrusted('/repo/c')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("counts a linked worktree as trusted when its repo is (Claude Code records the repo's root)", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-trust-')));
    const repo = path.join(dir, 'repo');
    const wt = path.join(repo, '.claude', 'worktrees', 'task-1');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    fs.mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'a');
    git('worktree', 'add', '-q', '-b', 'task-1', wt);
    process.env.CLAUDE_CONFIG_DIR = dir;
    const trust = (projects: Record<string, unknown>) =>
      fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects }));

    trust({});
    expect(await isWorkspaceTrusted(wt)).toBe(false);
    trust({ [repo]: { hasTrustDialogAccepted: true } });
    expect(await isWorkspaceTrusted(wt)).toBe(true);
    // Only the repo itself counts, not any folder above it.
    trust({ [dir]: { hasTrustDialogAccepted: true } });
    expect(await isWorkspaceTrusted(wt)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false when the state file is missing or unreadable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-trust-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    expect(await isWorkspaceTrusted('/repo/a')).toBe(false);
    fs.writeFileSync(path.join(dir, '.claude.json'), '{not json');
    expect(await isWorkspaceTrusted('/repo/a')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
