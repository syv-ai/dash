import { describe, it, expect } from 'vitest';
import { SETTINGS_REGISTRY, type SettingsState } from '../settingsKeys';

describe('settings registry', () => {
  it('maps theme to the legacy key with a dark default', () => {
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'theme')!;
    expect(e.key).toBe('theme');
    expect(e.codec.decode(null)).toBe('dark');
    expect(e.codec.encode('light')).toBe('light');
  });

  it('maps showTaskTokens to a true-by-default boolean', () => {
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'showTaskTokens')!;
    expect(e.key).toBe('showTaskTokens');
    expect(e.codec.decode(null)).toBe(true);
    expect(e.codec.encode(false)).toBe('false');
  });

  it('maps showTaskCost to a true-by-default boolean', () => {
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'showTaskCost')!;
    expect(e.key).toBe('showTaskCost');
    expect(e.codec.decode(null)).toBe(true);
    expect(e.codec.encode(false)).toBe('false');
  });

  it('keys are unique', () => {
    const keys = SETTINGS_REGISTRY.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Compile-time guard: every registry field is a SettingsState key.
  it('field type lines up with SettingsState', () => {
    const fields: (keyof SettingsState)[] = SETTINGS_REGISTRY.map((r) => r.field);
    expect(fields.length).toBe(SETTINGS_REGISTRY.length);
  });

  it('registers the phase-1b booleans with correct defaults', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.showRateLimits!.codec.decode(null)).toBe(true); // boolNotFalse
    expect(byField.showActiveTasksSection!.codec.decode('false')).toBe(false);
    expect(byField.desktopNotification!.codec.decode(null)).toBe(false); // boolDefaultFalse
    expect(byField.syncShellEnv!.codec.decode('true')).toBe(true);
    expect(byField.showProjectTokens!.codec.decode(null)).toBe(true); // boolDefaultTrue
  });

  it('registers the phase-1c string settings', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.effortLevel!.key).toBe('claudeEffortLevel'); // legacy key
    expect(byField.effortLevel!.codec.decode(null)).toBe('auto');
    expect(byField.terminalTheme!.codec.decode(null)).toBe('default');
    expect(byField.notificationSound!.codec.decode(null)).toBe('off');
    expect(byField.shellDrawerPosition!.codec.decode('bogus')).toBe('right');
    expect(byField.shellDrawerPosition!.codec.decode('main')).toBe('main');
  });

  it('registers the phase-1d json settings', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.rotationOrder!.codec.decode(null)).toEqual([]);
    expect(byField.customClaudeEnvVars!.codec.decode(null)).toEqual({});
    expect(byField.usageThresholds!.codec.decode(null)).toMatchObject({ contextPercentage: 80 });
    expect(byField.customIDE!.codec.decode(null)).toEqual({ path: '', args: [] });
    // validator rejects wrong shape
    expect(byField.customIDE!.codec.decode('{"path":123}')).toEqual({ path: '', args: [] });
  });

  it('registers the phase-1e set settings', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect([...(byField.rotationExclusions!.codec.decode(null) as Set<string>)]).toEqual([]);
    expect([...(byField.unseenTaskIds!.codec.decode('["t1","t2"]') as Set<string>)]).toEqual([
      't1',
      't2',
    ]);
  });

  it('registers the phase-1f special settings', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.commitAttribution!.codec.decode(null)).toBeUndefined();
    expect(byField.commitAttribution!.codec.decode('')).toBe('');
  });

  it('registers preferredIDE with an auto default', () => {
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'preferredIDE')!;
    expect(e.key).toBe('preferredIDE');
    expect(e.codec.decode(null)).toBe('auto');
    expect(e.codec.decode('vscode')).toBe('vscode');
  });

  it('registers keybindings with a merging codec defaulting to DEFAULT_KEYBINDINGS', async () => {
    const { DEFAULT_KEYBINDINGS } = await import('../../keybindings');
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'keybindings')!;
    expect(e.key).toBe('keybindings');
    expect(e.codec.decode(null)).toEqual(DEFAULT_KEYBINDINGS);
  });

  it('registers the phase-1i panel-collapse settings', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.sidebarCollapsed!.codec.decode(null)).toBe(false);
    expect(byField.changesPanelCollapsed!.codec.decode('true')).toBe(true);
    expect(byField.shellDrawerCollapsed!.codec.decode(null)).toBe(false);
    expect(byField.portsDrawerCollapsed!.codec.decode(null)).toBe(true); // boolDefaultTrue
  });

  it('registers the phase-1j update settings (default true)', () => {
    const byField = Object.fromEntries(SETTINGS_REGISTRY.map((r) => [r.field, r]));
    expect(byField.autoUpdateEnabled!.codec.decode(null)).toBe(true);
    expect(byField.autoUpdateEnabled!.codec.decode('false')).toBe(false);
    expect(byField.updateNotificationsEnabled!.codec.decode(null)).toBe(true);
  });

  it('registers lastSeenReleaseNotesVersion, undefined when absent', () => {
    const e = SETTINGS_REGISTRY.find((r) => r.field === 'lastSeenReleaseNotesVersion')!;
    expect(e.key).toBe('lastSeenReleaseNotesVersion');
    expect(e.codec.decode(null)).toBeUndefined();
    expect(e.codec.decode('0.13.0')).toBe('0.13.0');
    expect(e.codec.encode('0.13.0')).toBe('0.13.0');
  });
});
