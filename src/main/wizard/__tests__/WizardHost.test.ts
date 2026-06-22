import { describe, it, expect, beforeEach } from 'vitest';
import { WizardHost, type WizardWiring } from '../WizardHost';

// A fake BrowserWindow — WizardHost only calls isDestroyed() and
// webContents.send() on it.
const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };

/**
 * Spawn a wizard whose teardown we can drive manually. Captures the host-side
 * `onTeardown` so a test can simulate the wizard exiting with a given reason.
 */
async function spawnCapturing(
  host: WizardHost,
  opts: { featureId: string; taskId: string; projectId: string },
): Promise<(reason: string | null) => void> {
  let capturedOnTeardown: ((reason: string | null) => void) | null = null;
  await host.spawn({
    ...opts,
    cwd: '/tmp/x',
    getMainWindow: () => fakeWindow as never,
    createWizard: (wiring: WizardWiring) => {
      capturedOnTeardown = wiring.onTeardown;
      return { async start() {}, async teardown() {} };
    },
  });
  return capturedOnTeardown!;
}

describe('WizardHost project snooze', () => {
  let host: WizardHost;
  beforeEach(() => {
    host = new WizardHost();
  });

  it('"Not now" snoozes the whole project, covering sibling tasks', async () => {
    const teardown = await spawnCapturing(host, {
      featureId: 'ports',
      taskId: 't1',
      projectId: 'p1',
    });
    teardown('not-now');

    // The project is snoozed for every task in it — including siblings the
    // wizard never ran on.
    expect(host.isProjectSnoozed('ports', 'p1')).toBe(true);
    // A different project is unaffected.
    expect(host.isProjectSnoozed('ports', 'p2')).toBe(false);
  });

  it('a clean non-"not-now" exit does not snooze the project', async () => {
    const teardown = await spawnCapturing(host, {
      featureId: 'ports',
      taskId: 't1',
      projectId: 'p1',
    });
    teardown('not-relevant');
    expect(host.isProjectSnoozed('ports', 'p1')).toBe(false);
  });

  it('renderer reload clears the session snooze (re-offers)', async () => {
    const teardown = await spawnCapturing(host, {
      featureId: 'ports',
      taskId: 't1',
      projectId: 'p1',
    });
    teardown('not-now');
    expect(host.isProjectSnoozed('ports', 'p1')).toBe(true);

    await host.handleRendererReload();
    expect(host.isProjectSnoozed('ports', 'p1')).toBe(false);
  });
});
