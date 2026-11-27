import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadSharedWorkspaceConfig,
  loadWorkspaceConfig,
  writeWorkspaceConfig,
} from './WorkspaceConfigService';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-wsc-'));
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('loadWorkspaceConfig taskDefaults', () => {
  it('parses a valid taskDefaults block', () => {
    const proj = tmpProject();
    dirs.push(proj);
    fs.mkdirSync(path.join(proj, '.dash'));
    fs.writeFileSync(
      path.join(proj, '.dash', 'config.json'),
      JSON.stringify({
        taskDefaults: {
          baseRef: 'origin/main',
          permissionMode: 'acceptEdits',
          useWorktree: false,
          contextPrompt: 'Be concise.',
        },
      }),
    );
    const cfg = loadWorkspaceConfig(proj);
    expect(cfg?.taskDefaults).toEqual({
      baseRef: 'origin/main',
      permissionMode: 'acceptEdits',
      useWorktree: false,
      contextPrompt: 'Be concise.',
    });
  });

  it('drops an invalid permissionMode but keeps the other defaults', () => {
    const proj = tmpProject();
    dirs.push(proj);
    fs.mkdirSync(path.join(proj, '.dash'));
    fs.writeFileSync(
      path.join(proj, '.dash', 'config.json'),
      JSON.stringify({ taskDefaults: { permissionMode: 'nope', useWorktree: false } }),
    );
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({ useWorktree: false });
  });
});

function writeDash(proj: string, file: string, content: unknown): void {
  fs.mkdirSync(path.join(proj, '.dash'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.dash', file), JSON.stringify(content));
}

describe('loadWorkspaceConfig taskDefaults.dashAccess', () => {
  it('parses a boolean dashAccess', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', { taskDefaults: { dashAccess: true } });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({ dashAccess: true });
  });

  it('drops a non-boolean dashAccess', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', { taskDefaults: { dashAccess: 'yes' } });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toBeUndefined();
  });
});

describe('loadWorkspaceConfig config.local.json taskDefaults overlay', () => {
  it('overlays the shared taskDefaults key by key', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', { taskDefaults: { dashAccess: true, baseRef: 'main' } });
    writeDash(proj, 'config.local.json', { taskDefaults: { dashAccess: false } });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({ dashAccess: false, baseRef: 'main' });
  });

  it('applies every field from the local file, dropping invalid ones', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', {
      taskDefaults: { permissionMode: 'acceptEdits', contextPrompt: 'shared' },
    });
    writeDash(proj, 'config.local.json', {
      taskDefaults: {
        baseRef: 'origin/dev',
        permissionMode: 'nope',
        useWorktree: false,
        contextPrompt: 'mine',
      },
    });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({
      baseRef: 'origin/dev',
      permissionMode: 'acceptEdits',
      useWorktree: false,
      contextPrompt: 'mine',
    });
  });

  it('adds taskDefaults when only the local file has them', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', {});
    writeDash(proj, 'config.local.json', { taskDefaults: { dashAccess: true } });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({ dashAccess: true });
  });
});

describe('loadSharedWorkspaceConfig', () => {
  it('reads config.json and ignores config.local.json', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', { taskDefaults: { dashAccess: true } });
    writeDash(proj, 'config.local.json', {
      taskDefaults: { dashAccess: false, baseRef: 'origin/dev' },
    });
    expect(loadSharedWorkspaceConfig(proj)).toEqual({
      taskDefaults: { dashAccess: true },
    });
    // The merged read still overlays the local file.
    expect(loadWorkspaceConfig(proj)).toEqual({
      taskDefaults: { dashAccess: false, baseRef: 'origin/dev' },
    });
  });

  it('returns null without a config.json, even when a local file exists', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.local.json', { taskDefaults: { dashAccess: true } });
    expect(loadSharedWorkspaceConfig(proj)).toBeNull();
  });
});

describe('writeWorkspaceConfig', () => {
  it('round-trips and preserves unknown keys', () => {
    const proj = tmpProject();
    dirs.push(proj);
    fs.mkdirSync(path.join(proj, '.dash'));
    fs.writeFileSync(
      path.join(proj, '.dash', 'config.json'),
      JSON.stringify({ setup: ['pnpm install'], custom: { keep: true } }),
    );
    writeWorkspaceConfig(proj, { taskDefaults: { baseRef: 'origin/main' } });
    const raw = JSON.parse(fs.readFileSync(path.join(proj, '.dash', 'config.json'), 'utf-8'));
    expect(raw.taskDefaults).toEqual({ baseRef: 'origin/main' });
    expect(raw.setup).toEqual(['pnpm install']); // an old key nobody reads, left alone
    expect(raw.custom).toEqual({ keep: true }); // untouched unknown key
  });

  it('creates .dash/ when missing', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeWorkspaceConfig(proj, { taskDefaults: { useWorktree: true } });
    expect(fs.existsSync(path.join(proj, '.dash', 'config.json'))).toBe(true);
  });
});
