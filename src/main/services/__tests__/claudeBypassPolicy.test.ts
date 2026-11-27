import { describe, it, expect } from 'vitest';
import { bypassAvailability, type SettingsSource } from '../claudeBypassPolicy';

const accepted: SettingsSource = {
  scope: 'user',
  settings: { skipDangerousModePermissionPrompt: true },
};
const lock = { permissions: { disableBypassPermissionsMode: 'disable' } };

describe('bypassAvailability', () => {
  it('is available once the warning is accepted in user or managed settings', () => {
    expect(bypassAvailability([accepted])).toEqual({ available: true });
    expect(bypassAvailability([{ ...accepted, scope: 'managed' }])).toEqual({ available: true });
  });

  it('needs the acceptance: a project file does not count, as `claude --bg` ignores it', () => {
    expect(bypassAvailability([])).toEqual({ available: false, reason: 'not-accepted' });
    expect(bypassAvailability([{ ...accepted, scope: 'project' }])).toEqual({
      available: false,
      reason: 'not-accepted',
    });
  });

  it('is off when any file locks it, and says whether an organization did', () => {
    expect(bypassAvailability([accepted, { scope: 'project', settings: lock }])).toEqual({
      available: false,
      reason: 'disabled',
      managed: false,
    });
    expect(bypassAvailability([accepted, { scope: 'managed', settings: lock }])).toEqual({
      available: false,
      reason: 'disabled',
      managed: true,
    });
  });

  it('reads past a missing or broken file', () => {
    expect(
      bypassAvailability([
        { scope: 'managed', settings: undefined },
        { scope: 'project', settings: [] },
        { scope: 'project', settings: { permissions: 'x' } },
        accepted,
      ]),
    ).toEqual({ available: true });
  });
});
