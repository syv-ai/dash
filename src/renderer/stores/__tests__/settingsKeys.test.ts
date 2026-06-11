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
    expect(byField.showRateLimits.codec.decode(null)).toBe(true); // boolNotFalse
    expect(byField.showActiveTasksSection.codec.decode('false')).toBe(false);
    expect(byField.desktopNotification.codec.decode(null)).toBe(false); // boolDefaultFalse
    expect(byField.syncShellEnv.codec.decode('true')).toBe(true);
    expect(byField.showProjectTokens.codec.decode(null)).toBe(true); // boolDefaultTrue
  });
});
