import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';

// A new telemetry.json is written under userData, enabled only when packaged.
const app = { isPackaged: true, getPath: () => userData, getVersion: () => '0.0.0' };
let userData: string;
vi.mock('electron', () => ({ default: {}, app }));
const constructed = vi.fn();
const captured = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor() {
      constructed();
    }
    capture(msg: unknown) {
      captured(msg);
    }
    async shutdown() {}
  },
}));

beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'dash-telemetry-test-'));
  constructed.mockClear();
  captured.mockClear();
  delete process.env.TELEMETRY_ENABLED;
  vi.resetModules();
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

async function start(isPackaged: boolean) {
  app.isPackaged = isPackaged;
  const { TelemetryService } = await import('../TelemetryService');
  TelemetryService.initialize();
  const config = JSON.parse(readFileSync(path.join(userData, 'telemetry.json'), 'utf-8'));
  return { TelemetryService, config };
}

describe('TelemetryService default', () => {
  it('turns a new config on for a packaged build', async () => {
    const { TelemetryService, config } = await start(true);
    expect(config.enabled).toBe(true);
    expect(TelemetryService.isEnabled()).toBe(true);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('leaves a new config off for a dev run, so it sends nothing', async () => {
    const { TelemetryService, config } = await start(false);
    expect(config.enabled).toBe(false);
    expect(TelemetryService.isEnabled()).toBe(false);
    expect(constructed).not.toHaveBeenCalled();
  });
});

describe('TelemetryService guards', () => {
  it('sends nothing from a dev run even when its config says enabled', async () => {
    writeConfig(true);
    app.isPackaged = false;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    expect(TelemetryService.isEnabled()).toBe(false);
    expect(TelemetryService.capture('task_created')).toBe(false);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('sends from a dev run only when TELEMETRY_ENABLED=true asks for it', async () => {
    writeConfig(true);
    app.isPackaged = false;
    process.env.TELEMETRY_ENABLED = 'true';
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    expect(TelemetryService.isEnabled()).toBe(true);
  });

  it('honours the opt-out', async () => {
    writeConfig(false);
    app.isPackaged = true;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    expect(TelemetryService.capture('task_created')).toBe(false);
    expect(captured).not.toHaveBeenCalled();
  });
});

describe('TelemetryService properties', () => {
  async function packaged() {
    writeConfig(true);
    app.isPackaged = true;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    captured.mockClear();
    return TelemetryService;
  }
  const props = () =>
    (captured.mock.calls.at(-1)![0] as { properties: Record<string, unknown> }).properties;

  it('keeps the properties call sites send (they were dropped by the allowlist)', async () => {
    const t = await packaged();
    expect(t.capture('task_created', { kind: 'worktree-new-branch', source: 'ui' })).toBe(true);
    expect(props()).toMatchObject({ kind: 'worktree-new-branch', source: 'ui' });
    t.capture('worktree_migrated', { moved: 2, removed: 1, failed: 0 });
    expect(props()).toMatchObject({ moved: 2, removed: 1, failed: 0 });
  });

  it('scrubs paths out of exception messages and stacks', async () => {
    const t = await packaged();
    const home = os.homedir();
    t.capture('$exception', {
      $exception_message: `ENOENT: open '${home}/repos/secret/a.md'`,
      $exception_list: [{ type: 'Error', value: `at ${home}/repos/secret/b.ts:1:1` }],
    });
    expect(JSON.stringify(props())).not.toContain(home);
    expect(props().$exception_message).toBe("ENOENT: open '<path>'");
  });
});

function writeConfig(enabled: boolean) {
  writeFileSync(
    path.join(userData, 'telemetry.json'),
    JSON.stringify({ instanceId: 'test', enabled, lastActiveDate: null }),
  );
}
