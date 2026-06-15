import { describe, it, expect } from 'vitest';
import { useSettings } from '../settingsStore';

describe('settingsStore generated actions', () => {
  it('exposes a working value-setter for representative fields (name generation is correct)', () => {
    const s = useSettings.getState();
    s.setTheme('light');
    expect(useSettings.getState().theme).toBe('light');
    s.setShowTaskTokens(false);
    expect(useSettings.getState().showTaskTokens).toBe(false);
    s.setEffortLevel('high');
    expect(useSettings.getState().effortLevel).toBe('high');
    s.setShellDrawerCollapsed(true);
    expect(useSettings.getState().shellDrawerCollapsed).toBe(true);
  });

  it('generates a setter for every registered field', async () => {
    const { SETTINGS_REGISTRY } = await import('../settingsKeys');
    const store = useSettings.getState() as unknown as Record<string, unknown>;
    for (const e of SETTINGS_REGISTRY) {
      const name = `set${e.field[0]!.toUpperCase()}${e.field.slice(1)}`;
      expect(typeof store[name]).toBe('function');
    }
  });

  it('updater-capable actions accept either a value or a function', () => {
    const s = useSettings.getState();
    s.setUnseenTaskIds(new Set(['a']));
    expect([...useSettings.getState().unseenTaskIds]).toEqual(['a']);
    s.setUnseenTaskIds((prev) => new Set([...prev, 'b']));
    expect([...useSettings.getState().unseenTaskIds].sort()).toEqual(['a', 'b']);

    s.setPreferredIDE('vscode');
    s.setPreferredIDE((cur) => (cur === 'vscode' ? 'auto' : cur));
    expect(useSettings.getState().preferredIDE).toBe('auto');
  });
});
