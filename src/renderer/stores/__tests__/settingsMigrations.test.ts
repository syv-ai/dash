import { describe, it, expect } from 'vitest';
import { createMemoryStorage } from '../fanOutStorage';
import { runSettingsMigrations } from '../settingsMigrations';

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
});
