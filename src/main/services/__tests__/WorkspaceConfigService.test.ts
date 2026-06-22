import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadWorkspaceConfig,
  buildWorkspaceEnv,
  getResolvedSetupCommands,
  resolveSetupCommand,
  resolveTeardownCommand,
} from '../WorkspaceConfigService';

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

  it('parses setup, teardown, run arrays', () => {
    writeJson('.dash/config.json', {
      setup: ['pnpm install'],
      teardown: ['./scripts/cleanup.sh'],
      run: ['pnpm dev'],
    });
    expect(loadWorkspaceConfig(tmpDir)).toEqual({
      setup: ['pnpm install'],
      teardown: ['./scripts/cleanup.sh'],
      run: ['pnpm dev'],
    });
  });

  it('parses cwd', () => {
    writeJson('.dash/config.json', {
      setup: ['pnpm install'],
      cwd: 'apps/web',
    });
    expect(loadWorkspaceConfig(tmpDir)).toEqual({
      setup: ['pnpm install'],
      cwd: 'apps/web',
    });
  });

  it('returns empty config when file has no recognised keys', () => {
    writeJson('.dash/config.json', {});
    expect(loadWorkspaceConfig(tmpDir)).toEqual({});
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

  it('returns null when setup is not an array of strings', () => {
    writeJson('.dash/config.json', { setup: 'pnpm install' });
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it('returns null when setup array contains non-strings', () => {
    writeJson('.dash/config.json', { setup: ['pnpm install', 42] });
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it('returns null when cwd is an empty string', () => {
    writeJson('.dash/config.json', { cwd: '   ' });
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it('returns null when cwd is not a string', () => {
    writeJson('.dash/config.json', { cwd: 42 });
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });
});

describe('loadWorkspaceConfig — config.local.json array overlay', () => {
  it('local array completely replaces base array', () => {
    writeJson('.dash/config.json', { setup: ['pnpm install'] });
    writeJson('.dash/config.local.json', { setup: ['nix-shell', 'pnpm install'] });
    expect(loadWorkspaceConfig(tmpDir)?.setup).toEqual(['nix-shell', 'pnpm install']);
  });
});

describe('loadWorkspaceConfig — config.local.json sandwich overlay', () => {
  it('prepends "before" commands to base', () => {
    writeJson('.dash/config.json', { setup: ['pnpm install'] });
    writeJson('.dash/config.local.json', { setup: { before: ['nix-shell'] } });
    expect(loadWorkspaceConfig(tmpDir)?.setup).toEqual(['nix-shell', 'pnpm install']);
  });

  it('appends "after" commands to base', () => {
    writeJson('.dash/config.json', { setup: ['pnpm install'] });
    writeJson('.dash/config.local.json', { setup: { after: ['cp ../.env .env'] } });
    expect(loadWorkspaceConfig(tmpDir)?.setup).toEqual(['pnpm install', 'cp ../.env .env']);
  });

  it('combines before + base + after', () => {
    writeJson('.dash/config.json', { setup: ['pnpm install'] });
    writeJson('.dash/config.local.json', {
      setup: { before: ['nix-shell'], after: ['cp ../.env .env'] },
    });
    expect(loadWorkspaceConfig(tmpDir)?.setup).toEqual([
      'nix-shell',
      'pnpm install',
      'cp ../.env .env',
    ]);
  });

  it('applies sandwich when base key is absent', () => {
    writeJson('.dash/config.json', {});
    writeJson('.dash/config.local.json', { setup: { before: ['pre'], after: ['post'] } });
    expect(loadWorkspaceConfig(tmpDir)?.setup).toEqual(['pre', 'post']);
  });
});

describe('buildWorkspaceEnv', () => {
  it('exposes DASH_TASK_ID, DASH_WORKTREE_PATH, DASH_PROJECT_PATH', () => {
    expect(
      buildWorkspaceEnv({
        taskId: 'task-abc',
        worktreePath: '/repos/proj/worktrees/feat-x',
        projectPath: '/repos/proj',
      }),
    ).toEqual({
      DASH_TASK_ID: 'task-abc',
      DASH_WORKTREE_PATH: '/repos/proj/worktrees/feat-x',
      DASH_PROJECT_PATH: '/repos/proj',
    });
  });

  it('includes DASH_BRANCH when provided', () => {
    expect(
      buildWorkspaceEnv({
        taskId: 'task-abc',
        worktreePath: '/repos/proj/worktrees/feat-x',
        projectPath: '/repos/proj',
        branch: 'feature-x-abc123',
      }),
    ).toEqual({
      DASH_TASK_ID: 'task-abc',
      DASH_WORKTREE_PATH: '/repos/proj/worktrees/feat-x',
      DASH_PROJECT_PATH: '/repos/proj',
      DASH_BRANCH: 'feature-x-abc123',
    });
  });

  it('omits DASH_TASK_ID when taskId is not provided (e.g. setup-script context)', () => {
    expect(
      buildWorkspaceEnv({
        worktreePath: '/repos/proj/worktrees/feat-x',
        projectPath: '/repos/proj',
      }),
    ).toEqual({
      DASH_WORKTREE_PATH: '/repos/proj/worktrees/feat-x',
      DASH_PROJECT_PATH: '/repos/proj',
    });
  });
});

describe('getResolvedSetupCommands', () => {
  it('returns [] for null config', () => {
    expect(getResolvedSetupCommands(null)).toEqual([]);
  });

  it('returns [] when setup key is absent', () => {
    expect(getResolvedSetupCommands({})).toEqual([]);
  });

  it('filters whitespace-only entries', () => {
    expect(
      getResolvedSetupCommands({
        setup: ['pnpm install', '   ', '', 'cp ../.env .env'],
      }),
    ).toEqual(['pnpm install', 'cp ../.env .env']);
  });
});

describe('resolveSetupCommand', () => {
  it('returns null when no config and no fallback', () => {
    expect(resolveSetupCommand({ config: null, fallbackScriptPath: null })).toBeNull();
  });

  it('joins config setup commands with " && "', () => {
    expect(
      resolveSetupCommand({
        config: { setup: ['pnpm install', 'cp ../.env .env'] },
        fallbackScriptPath: null,
      }),
    ).toBe('pnpm install && cp ../.env .env');
  });

  it('filters empty entries before joining', () => {
    expect(
      resolveSetupCommand({
        config: { setup: ['pnpm install', '   ', 'cp ../.env .env'] },
        fallbackScriptPath: null,
      }),
    ).toBe('pnpm install && cp ../.env .env');
  });

  it('falls back to bash <script> when config has no setup', () => {
    expect(resolveSetupCommand({ config: {}, fallbackScriptPath: '/repo/.dash/setup.sh' })).toBe(
      "bash '/repo/.dash/setup.sh'",
    );
  });

  it('config wins over fallback', () => {
    expect(
      resolveSetupCommand({
        config: { setup: ['pnpm install'] },
        fallbackScriptPath: '/repo/.dash/setup.sh',
      }),
    ).toBe('pnpm install');
  });

  it('POSIX-quotes paths containing single quotes', () => {
    expect(
      resolveSetupCommand({
        config: null,
        fallbackScriptPath: "/repo/with'apos/.dash/setup.sh",
      }),
    ).toBe("bash '/repo/with'\\''apos/.dash/setup.sh'");
  });
});

describe('resolveTeardownCommand', () => {
  it('returns null when no config and no fallback', () => {
    expect(resolveTeardownCommand({ config: null, fallbackScriptPath: null })).toBeNull();
  });

  it('joins config teardown commands with " && "', () => {
    expect(
      resolveTeardownCommand({
        config: { teardown: ['docker compose down', 'rm -rf node_modules'] },
        fallbackScriptPath: null,
      }),
    ).toBe('docker compose down && rm -rf node_modules');
  });

  it('falls back to bash <script> when config has no teardown', () => {
    expect(
      resolveTeardownCommand({ config: {}, fallbackScriptPath: '/repo/.dash/teardown.sh' }),
    ).toBe("bash '/repo/.dash/teardown.sh'");
  });

  it('config teardown wins over fallback', () => {
    expect(
      resolveTeardownCommand({
        config: { teardown: ['./cleanup.sh'] },
        fallbackScriptPath: '/repo/.dash/teardown.sh',
      }),
    ).toBe('./cleanup.sh');
  });

  it('ignores setup commands when resolving teardown', () => {
    expect(
      resolveTeardownCommand({
        config: { setup: ['pnpm install'] },
        fallbackScriptPath: null,
      }),
    ).toBeNull();
  });
});
