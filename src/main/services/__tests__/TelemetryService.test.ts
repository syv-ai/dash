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
const exceptions = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor() {
      constructed();
    }
    capture(msg: unknown) {
      captured(msg);
    }
    captureException(...args: unknown[]) {
      exceptions(...args);
    }
    async shutdown() {}
  },
}));

beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'dash-telemetry-test-'));
  constructed.mockClear();
  captured.mockClear();
  exceptions.mockClear();
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

  it('drops the old free-text exception properties from plain capture', async () => {
    const t = await packaged();
    t.capture('task_created', { $exception_message: 'x', error_message: 'y' });
    expect(props()).not.toHaveProperty('$exception_message');
    expect(props()).not.toHaveProperty('error_message');
  });
});

describe('captureDaily', () => {
  it('sends an event once a day per key', async () => {
    writeConfig(true);
    app.isPackaged = true;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    const props = { command: 'tasks.list', source: 'task' };
    expect(TelemetryService.captureDaily('a', 'dashctl_called', props)).toBe(true);
    expect(TelemetryService.captureDaily('a', 'dashctl_called', props)).toBe(false);
    expect(TelemetryService.captureDaily('b', 'dashctl_called', props)).toBe(true);
  });
});

describe('claude_contract_drift', () => {
  it('sends the shape of a drift, nothing else', async () => {
    writeConfig(true);
    app.isPackaged = true;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    captured.mockClear();
    const sent = TelemetryService.captureDrift({
      claudeVersion: '2.1.333',
      source: 'hook:Notification',
      kind: 'unknown-enum-value',
      path: 'notification_type',
      value: 'agent_waiting',
    });
    expect(sent).toBe(true);
    const msg = captured.mock.calls[0]![0] as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(msg.event).toBe('claude_contract_drift');
    expect(msg.properties).toMatchObject({
      claude_version: '2.1.333',
      source: 'hook:Notification',
      kind: 'unknown-enum-value',
      field_path: 'notification_type',
      enum_value: 'agent_waiting',
    });
  });
});

describe('error tracking', () => {
  async function packaged() {
    writeConfig(true);
    app.isPackaged = true;
    const mod = await import('../TelemetryService');
    mod.TelemetryService.initialize();
    return mod;
  }

  it('reports an exception once a minute per error, with its source', async () => {
    const { TelemetryService } = await packaged();
    const err = new Error('boom');
    expect(TelemetryService.captureException(err, { source: 'ipc', channel: 'git:push' })).toBe(
      true,
    );
    expect(TelemetryService.captureException(err, { source: 'ipc', channel: 'git:push' })).toBe(
      false,
    );
    expect(exceptions).toHaveBeenCalledTimes(1);
    const [sentErr, distinctId, props] = exceptions.mock.calls[0]!;
    expect(sentErr).toBe(err);
    expect(distinctId).toBe('test');
    expect(props).toMatchObject({ source: 'ipc', channel: 'git:push', app_version: '0.0.0' });
  });

  it('scrubs every string of an $exception event before it is sent', async () => {
    const { scrubExceptionEvent } = await packaged();
    const home = os.homedir();
    const event = scrubExceptionEvent({
      event: '$exception',
      distinctId: 'x',
      properties: {
        $exception_list: [
          {
            value: `ENOENT: open '${home}/repos/secret/a.md'`,
            stacktrace: {
              frames: [{ filename: `${home}/repos/dash/x.js`, abs_path: `${home}/x.js` }],
            },
          },
        ],
      },
    });
    expect(JSON.stringify(event)).not.toContain(home);
    expect(JSON.stringify(event)).toContain("ENOENT: open '<path>'");
  });

  it('counts an IPC failure by channel and code only', async () => {
    const { TelemetryService } = await packaged();
    captured.mockClear();
    expect(TelemetryService.captureIpcFailure('git:push', 'UNKNOWN')).toBe(true);
    const msg = captured.mock.calls[0]![0] as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(msg.event).toBe('ipc_failed');
    expect(msg.properties).toMatchObject({ channel: 'git:push', error_code: 'UNKNOWN' });
  });
});

describe('app_update_installed', () => {
  it('fires on the first launch of a new version, once', async () => {
    writeFileSync(
      path.join(userData, 'telemetry.json'),
      JSON.stringify({
        instanceId: 'test',
        enabled: true,
        lastActiveDate: null,
        lastVersion: '0.0.0-old',
      }),
    );
    app.isPackaged = true;
    let { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    const installs = () =>
      captured.mock.calls
        .map((c) => c[0] as { event: string; properties: Record<string, unknown> })
        .filter((m) => m.event === 'app_update_installed');
    expect(installs().map((m) => m.properties)).toEqual([
      expect.objectContaining({ from_version: '0.0.0-old', to_version: '0.0.0' }),
    ]);
    await TelemetryService.shutdown();
    vi.resetModules();
    ({ TelemetryService } = await import('../TelemetryService'));
    TelemetryService.initialize();
    expect(installs()).toHaveLength(1);
  });
});

describe('daily usage', () => {
  const sent = (event: string) =>
    captured.mock.calls
      .map((c) => c[0] as { event: string; properties: Record<string, unknown> })
      .filter((m) => m.event === event);

  it("sends the last closed day's active minutes with the first daily-active of a day, read from disk", async () => {
    writeFileSync(
      path.join(userData, 'telemetry.json'),
      JSON.stringify({
        instanceId: 'test',
        enabled: true,
        lastActiveDate: '2026-01-01',
        // Left by a run that crashed: no clean quit, the minutes still count.
        usage: { current: { date: '2026-01-01', activeMinutes: 75, peakBusy: 3 }, finished: null },
      }),
    );
    app.isPackaged = true;
    const { TelemetryService } = await import('../TelemetryService');
    TelemetryService.initialize();
    expect(sent('daily_active_user')[0]!.properties).toMatchObject({
      active_minutes_bucket: '1h_2h',
    });
  });

  it('sends one usage snapshot a day, with bucketed counts and the closed day’s peak', async () => {
    vi.useFakeTimers();
    try {
      writeFileSync(
        path.join(userData, 'telemetry.json'),
        JSON.stringify({
          instanceId: 'test',
          enabled: true,
          lastActiveDate: null,
          usage: { current: { date: '2026-01-01', activeMinutes: 5, peakBusy: 4 }, finished: null },
        }),
      );
      app.isPackaged = true;
      const { TelemetryService } = await import('../TelemetryService');
      TelemetryService.initialize();
      TelemetryService.noteSessions({ live: 7, busy: 2 });
      TelemetryService.setUsageSource({
        counts: () => ({ projects: 3, openTasks: 12 }),
        isForeground: () => false,
      });
      expect(sent('usage_snapshot')).toEqual([]);
      vi.advanceTimersByTime(5 * 60_000);
      expect(sent('usage_snapshot').map((m) => m.properties)).toEqual([
        expect.objectContaining({
          project_count: '2_3',
          open_task_count: '11_20',
          live_session_count: '6_10',
          peak_busy_sessions: '4_5',
        }),
      ]);
      vi.advanceTimersByTime(60 * 60_000);
      expect(sent('usage_snapshot')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      const { TelemetryService } = await import('../TelemetryService');
      await TelemetryService.shutdown();
    }
  });
});

function writeConfig(enabled: boolean) {
  writeFileSync(
    path.join(userData, 'telemetry.json'),
    JSON.stringify({ instanceId: 'test', enabled, lastActiveDate: null }),
  );
}
