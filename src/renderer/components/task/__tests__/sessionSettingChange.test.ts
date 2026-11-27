import { describe, it, expect } from 'vitest';
import type { BypassAvailability } from '../../../../shared/types';
import {
  bypassUnavailableReason,
  liveModelDiffers,
  planSessionSettingChange,
  sessionModeNote,
  sessionModelNote,
  type SessionSettingChange,
} from '../sessionSettingChange';

const AVAILABLE = { available: true } as const;
const TASK = { permissionMode: 'auto', model: 'haiku', dashAccess: false } as const;

const plan = (
  change: SessionSettingChange,
  hasSession: boolean,
  bypass: BypassAvailability | null = null,
) => planSessionSettingChange({ task: TASK, change, hasSession, bypass });

describe('planSessionSettingChange', () => {
  it('does nothing for the value the task already has, whichever setting', () => {
    expect(plan({ setting: 'permissionMode', to: 'auto' }, true)).toEqual({ kind: 'none' });
    expect(plan({ setting: 'model', to: 'haiku' }, true)).toEqual({ kind: 'none' });
    expect(plan({ setting: 'dashAccess', to: false }, true)).toEqual({ kind: 'none' });
  });

  it('restarts a task with a session into Yolo, after a confirm that says both', () => {
    const p = plan({ setting: 'permissionMode', to: 'bypassPermissions' }, true, AVAILABLE);
    expect(p).toMatchObject({ kind: 'apply', restart: true });
    if (p.kind !== 'apply') throw new Error('unreachable');
    expect(p.confirm?.message).toMatch(/skips every permission prompt/);
    expect(p.confirm?.message).toMatch(/restarts the session.*same conversation/);
    expect(p.confirm?.confirmLabel).toBe('Restart in Yolo');
  });

  it('still confirms Yolo for a task with no session, without a restart', () => {
    const p = plan({ setting: 'permissionMode', to: 'bypassPermissions' }, false, AVAILABLE);
    expect(p).toMatchObject({ kind: 'apply', restart: false });
    if (p.kind !== 'apply') throw new Error('unreachable');
    expect(p.confirm?.message).not.toMatch(/restarts/);
  });

  it('blocks Yolo when a setting turns it off or the warning was never accepted', () => {
    expect(
      plan({ setting: 'permissionMode', to: 'bypassPermissions' }, true, {
        available: false,
        reason: 'disabled',
        managed: true,
      }),
    ).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/organization/) });
    expect(
      plan({ setting: 'permissionMode', to: 'bypassPermissions' }, false, {
        available: false,
        reason: 'not-accepted',
      }),
    ).toMatchObject({ kind: 'blocked' });
  });

  it.each<[SessionSettingChange, string]>([
    [{ setting: 'permissionMode', to: 'acceptEdits' }, 'Switch this task to Accept edits?'],
    [{ setting: 'model', to: 'sonnet' }, 'Switch this task to Sonnet?'],
    [{ setting: 'model', to: 'default' }, 'Switch this task to Default?'],
    [{ setting: 'dashAccess', to: true }, 'Turn on Dash access?'],
  ])('restarts a session for %o, since the job keeps its old flags', (change, title) => {
    expect(plan(change, true)).toEqual({
      kind: 'apply',
      restart: true,
      confirm: {
        title,
        message: 'Switching restarts the session, which resumes the same conversation.',
        confirmLabel: 'Restart session',
      },
    });
  });

  it('saves without a word when there is no session to restart', () => {
    expect(plan({ setting: 'model', to: 'sonnet' }, false)).toEqual({
      kind: 'apply',
      restart: false,
      confirm: null,
    });
    expect(plan({ setting: 'dashAccess', to: true }, false)).toEqual({
      kind: 'apply',
      restart: false,
      confirm: null,
    });
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

describe('sessionModelNote', () => {
  it("speaks only when the session's model isn't the task's family", () => {
    expect(sessionModelNote('sonnet', null)).toBeUndefined();
    expect(sessionModelNote('sonnet', 'Sonnet 4.6')).toBeUndefined();
    expect(sessionModelNote('sonnet', 'Haiku 4.5')).toBe('The session is on Haiku 4.5 now.');
  });

  it('never calls a task on the default model mismatched: it names no family', () => {
    expect(liveModelDiffers('default', 'Opus 5.5')).toBe(false);
  });
});
