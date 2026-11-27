import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkspaceConfig } from '../WorkspaceConfigService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(rel: string, value: unknown): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2));
}

describe('loadWorkspaceConfig — basic parsing', () => {
  it('returns null when no .dash/config.json exists', () => {
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it('returns empty config when file has no recognised keys', () => {
    writeJson('.dash/config.json', {});
    expect(loadWorkspaceConfig(tmpDir)).toEqual({});
  });

  it('ignores the old worktree script keys', () => {
    writeJson('.dash/config.json', {
      setup: ['pnpm install'],
      teardown: 'not even an array',
      cwd: 'apps/web',
      taskDefaults: { useWorktree: false },
    });
    expect(loadWorkspaceConfig(tmpDir)).toEqual({ taskDefaults: { useWorktree: false } });
  });
});

describe('loadWorkspaceConfig — validation', () => {
  it('returns null when JSON is malformed', () => {
    const abs = path.join(tmpDir, '.dash', 'config.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ this is not json');
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it('returns null when root is not an object', () => {
    writeJson('.dash/config.json', ['pnpm install']);
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });
});

describe('loadWorkspaceConfig — config.local.json without config.json', () => {
  it('applies the local overlay onto an empty config', () => {
    writeJson('.dash/config.local.json', { taskDefaults: { dashAccess: true } });
    expect(loadWorkspaceConfig(tmpDir)).toEqual({ taskDefaults: { dashAccess: true } });
  });

  it('still returns null for a malformed config.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.dash'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.dash/config.json'), '{ nope');
    writeJson('.dash/config.local.json', { taskDefaults: { dashAccess: true } });
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });
});
