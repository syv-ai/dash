import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtempSync, readFileSync, rmSync } from 'fs';

// A new telemetry.json is written under userData, enabled only when packaged.
const app = { isPackaged: true, getPath: () => userData, getVersion: () => '0.0.0' };
let userData: string;
vi.mock('electron', () => ({ default: {}, app }));
const constructed = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor() {
      constructed();
    }
    capture() {}
    async shutdown() {}
  },
}));

beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'dash-telemetry-test-'));
  constructed.mockClear();
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
