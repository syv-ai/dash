import { describe, it, expect } from 'vitest';
import { createMemoryStorage } from '../fanOutStorage';
import { SCHEMA_KEY, runSettingsMigrations } from '../settingsMigrations';
import { defaultSettings } from '../settingsKeys';

describe('runSettingsMigrations', () => {
  it("rewrites legacy preferredIDE 'code' to 'vscode'", () => {
    const mem = createMemoryStorage();
    mem.setItem('preferredIDE', 'code');
    runSettingsMigrations(mem);
    expect(mem.getItem('preferredIDE')).toBe('vscode');
  });

  it('leaves other preferredIDE values untouched', () => {
    const mem = createMemoryStorage();
    mem.setItem('preferredIDE', 'vscode');
    runSettingsMigrations(mem);
    expect(mem.getItem('preferredIDE')).toBe('vscode');
  });

  it('no-ops when the key is absent', () => {
    const mem = createMemoryStorage();
    runSettingsMigrations(mem);
    expect(mem.getItem('preferredIDE')).toBeNull();
  });

  it('drops the old webglHeldLimit (it counted WebGL contexts, not terminals)', () => {
    const mem = createMemoryStorage();
    mem.setItem('webglHeldLimit', '12');
    runSettingsMigrations(mem);
    expect(mem.getItem('webglHeldLimit')).toBeNull();
    expect(mem.getItem('terminalsKeptReady')).toBeNull();
  });

  describe('theme default (System since schema 1)', () => {
    it('gives a new install System', () => {
      const mem = createMemoryStorage();
      runSettingsMigrations(mem);
      expect(mem.getItem('theme')).toBeNull();
      expect(defaultSettings().theme).toBe('system');
      // A later launch, with settings stored by then, doesn't take it back.
      mem.setItem('showTaskTokens', 'false');
      runSettingsMigrations(mem);
      expect(mem.getItem('theme')).toBeNull();
    });

    it('keeps an existing install on Dark, the default it had', () => {
      const mem = createMemoryStorage();
      mem.setItem('showTaskTokens', 'false');
      runSettingsMigrations(mem);
      expect(mem.getItem('theme')).toBe('dark');
      expect(mem.getItem(SCHEMA_KEY)).toBe('1');
    });

    it("keeps an existing install's own choice", () => {
      const mem = createMemoryStorage();
      mem.setItem('theme', 'light');
      runSettingsMigrations(mem);
      expect(mem.getItem('theme')).toBe('light');
    });

    it('runs once: a later launch leaves the theme alone', () => {
      const mem = createMemoryStorage();
      mem.setItem('showTaskTokens', 'false');
      runSettingsMigrations(mem);
      mem.removeItem('theme');
      runSettingsMigrations(mem);
      expect(mem.getItem('theme')).toBeNull();
    });
  });
});
