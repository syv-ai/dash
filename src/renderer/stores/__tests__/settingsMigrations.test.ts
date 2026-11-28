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
      expect(mem.getItem(SCHEMA_KEY)).toBe('3');
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

  describe('Ultracode folds into Effort (schema 2)', () => {
    it('turns the Ultracode switch into the Ultracode effort', () => {
      const mem = createMemoryStorage();
      mem.setItem('claudeEffortLevel', 'high');
      mem.setItem('ultracode', 'true');
      runSettingsMigrations(mem);
      expect(mem.getItem('claudeEffortLevel')).toBe('ultracode');
      expect(mem.getItem('ultracode')).toBeNull();
    });

    it('keeps the effort when Ultracode was off', () => {
      const mem = createMemoryStorage();
      mem.setItem('claudeEffortLevel', 'high');
      mem.setItem('ultracode', 'false');
      runSettingsMigrations(mem);
      expect(mem.getItem('claudeEffortLevel')).toBe('high');
      expect(mem.getItem('ultracode')).toBeNull();
    });
  });

  describe("Yolo becomes New task's default permission mode (schema 3)", () => {
    it('carries the old yoloMode switch over', () => {
      const mem = createMemoryStorage();
      mem.setItem('yoloMode', 'true');
      runSettingsMigrations(mem);
      expect(mem.getItem('permissionMode')).toBe('bypassPermissions');
      expect(mem.getItem('yoloMode')).toBeNull();
    });

    it('keeps a mode picked since', () => {
      const mem = createMemoryStorage();
      mem.setItem('yoloMode', 'true');
      mem.setItem('permissionMode', 'acceptEdits');
      runSettingsMigrations(mem);
      expect(mem.getItem('permissionMode')).toBe('acceptEdits');
    });

    it('keeps the last model and mode New task remembered as the defaults', () => {
      const mem = createMemoryStorage();
      mem.setItem('taskModel', 'opus');
      mem.setItem('permissionMode', 'default');
      runSettingsMigrations(mem);
      const s = defaultSettings();
      expect(s.newTaskModel).toBe('default');
      expect(mem.getItem('taskModel')).toBe('opus');
      expect(mem.getItem('permissionMode')).toBe('default');
    });
  });
});
