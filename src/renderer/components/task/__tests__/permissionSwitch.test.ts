import { describe, it, expect } from 'vitest';
import {
  bypassUnavailableReason,
  planPermissionSwitch,
  sessionModeNote,
} from '../permissionSwitch';

const AVAILABLE = { available: true } as const;

describe('planPermissionSwitch', () => {
  it('does nothing for the mode the task already has', () => {
    expect(
      planPermissionSwitch({ from: 'auto', to: 'auto', hasSession: true, bypass: null }),
    ).toEqual({ kind: 'none' });
  });

  it('restarts a task with a session into Yolo, after a confirm that says both', () => {
    const plan = planPermissionSwitch({
      from: 'default',
      to: 'bypassPermissions',
      hasSession: true,
      bypass: AVAILABLE,
    });
    expect(plan).toMatchObject({ kind: 'apply', restart: true });
    if (plan.kind !== 'apply') throw new Error('unreachable');
    expect(plan.confirm?.message).toMatch(/skips every permission prompt/);
    expect(plan.confirm?.message).toMatch(/restarts the session.*same conversation/);
    expect(plan.confirm?.confirmLabel).toBe('Restart in Yolo');
  });

  it('still confirms Yolo for a task with no session, without a restart', () => {
    const plan = planPermissionSwitch({
      from: 'auto',
      to: 'bypassPermissions',
      hasSession: false,
      bypass: AVAILABLE,
    });
    expect(plan).toMatchObject({ kind: 'apply', restart: false });
    if (plan.kind !== 'apply') throw new Error('unreachable');
    expect(plan.confirm?.message).not.toMatch(/restarts/);
  });

  it('blocks Yolo when a setting turns it off or the warning was never accepted', () => {
    expect(
      planPermissionSwitch({
        from: 'auto',
        to: 'bypassPermissions',
        hasSession: true,
        bypass: { available: false, reason: 'disabled', managed: true },
      }),
    ).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/organization/) });
    expect(
      planPermissionSwitch({
        from: 'auto',
        to: 'bypassPermissions',
        hasSession: false,
        bypass: { available: false, reason: 'not-accepted' },
      }),
    ).toMatchObject({ kind: 'blocked' });
  });

  it('restarts a session for any other mode too: the job keeps its old flags', () => {
    expect(
      planPermissionSwitch({
        from: 'bypassPermissions',
        to: 'auto',
        hasSession: true,
        bypass: null,
      }),
    ).toMatchObject({ kind: 'apply', restart: true, confirm: { confirmLabel: 'Restart session' } });
    expect(
      planPermissionSwitch({
        from: 'bypassPermissions',
        to: 'auto',
        hasSession: false,
        bypass: null,
      }),
    ).toEqual({ kind: 'apply', restart: false, confirm: null });
  });
});

describe('bypassUnavailableReason', () => {
  it('has none while unknown or available', () => {
    expect(bypassUnavailableReason(null)).toBeNull();
    expect(bypassUnavailableReason(AVAILABLE)).toBeNull();
  });

  it('names the setting, and whose it is', () => {
    expect(
      bypassUnavailableReason({ available: false, reason: 'disabled', managed: false }),
    ).toMatch(/A Claude Code settings file.*disableBypassPermissionsMode/);
  });
});

describe('sessionModeNote', () => {
  it("speaks only when the session's mode isn't the task's", () => {
    expect(sessionModeNote('auto', undefined)).toBeUndefined();
    expect(sessionModeNote('auto', 'auto')).toBeUndefined();
    expect(sessionModeNote('bypassPermissions', 'auto')).toBe('The session is in Auto now.');
    expect(sessionModeNote('default', 'plan')).toBe('The session is in Plan now.');
  });
});
