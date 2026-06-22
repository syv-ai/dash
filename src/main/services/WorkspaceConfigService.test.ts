import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkspaceConfig, writeWorkspaceConfig } from './WorkspaceConfigService';

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
