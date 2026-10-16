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
        setup: ['pnpm install'],
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

  it('drops an invalid permissionMode but keeps the rest of the config', () => {
    const proj = tmpProject();
    dirs.push(proj);
    fs.mkdirSync(path.join(proj, '.dash'));
    fs.writeFileSync(
      path.join(proj, '.dash', 'config.json'),
      JSON.stringify({ setup: ['x'], taskDefaults: { permissionMode: 'nope' } }),
    );
    const cfg = loadWorkspaceConfig(proj);
    expect(cfg?.setup).toEqual(['x']);
    expect(cfg?.taskDefaults?.permissionMode).toBeUndefined();
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
    writeDash(proj, 'config.json', { setup: ['x'], taskDefaults: { dashAccess: 'yes' } });
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
    writeDash(proj, 'config.json', { setup: ['x'] });
    writeDash(proj, 'config.local.json', { taskDefaults: { dashAccess: true } });
    expect(loadWorkspaceConfig(proj)?.taskDefaults).toEqual({ dashAccess: true });
  });
});

describe('loadSharedWorkspaceConfig', () => {
  it('reads config.json and ignores config.local.json', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeDash(proj, 'config.json', { setup: ['x'], taskDefaults: { dashAccess: true } });
    writeDash(proj, 'config.local.json', {
      setup: { after: ['mine'] },
      taskDefaults: { dashAccess: false, baseRef: 'origin/dev' },
    });
    expect(loadSharedWorkspaceConfig(proj)).toEqual({
      setup: ['x'],
      taskDefaults: { dashAccess: true },
    });
    // The merged read still overlays the local file.
    expect(loadWorkspaceConfig(proj)).toEqual({
      setup: ['x', 'mine'],
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
      JSON.stringify({ run: ['serve'], custom: { keep: true } }),
    );
    writeWorkspaceConfig(proj, {
      setup: ['pnpm install'],
      teardown: ['docker compose down'],
      taskDefaults: { baseRef: 'origin/main' },
    });
    const raw = JSON.parse(fs.readFileSync(path.join(proj, '.dash', 'config.json'), 'utf-8'));
    expect(raw.setup).toEqual(['pnpm install']);
    expect(raw.teardown).toEqual(['docker compose down']);
    expect(raw.taskDefaults).toEqual({ baseRef: 'origin/main' });
    expect(raw.run).toEqual(['serve']); // untouched known key
    expect(raw.custom).toEqual({ keep: true }); // untouched unknown key
  });

  it('creates .dash/ when missing', () => {
    const proj = tmpProject();
    dirs.push(proj);
    writeWorkspaceConfig(proj, { setup: ['echo hi'] });
    expect(fs.existsSync(path.join(proj, '.dash', 'config.json'))).toBe(true);
  });
});
