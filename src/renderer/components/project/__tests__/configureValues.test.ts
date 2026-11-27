import { describe, it, expect } from 'vitest';
import {
  configToValues,
  localToValues,
  localValuesOk,
  valuesToConfig,
  valuesToLocal,
} from '../configureValues';

const fallbacks = { name: 'p', baseRef: 'origin/main' };

describe('configure form dashAccess', () => {
  it('reads the project default, off when unset', () => {
    expect(configToValues(null, fallbacks).dashAccess).toBe(false);
    expect(configToValues({ taskDefaults: { dashAccess: true } }, fallbacks).dashAccess).toBe(true);
  });

  it('writes only an opt-in', () => {
    const on = { ...configToValues(null, fallbacks), dashAccess: true };
    expect(valuesToConfig(on).taskDefaults?.dashAccess).toBe(true);
    const off = configToValues(null, fallbacks);
    expect(valuesToConfig(off).taskDefaults).not.toHaveProperty('dashAccess', false);
  });
});

describe('configure form permissionMode', () => {
  it('reads auto when unset, and writes a mode only when it is not auto', () => {
    const unset = configToValues(null, fallbacks);
    expect(unset.permissionMode).toBe('auto');
    expect(valuesToConfig(unset).taskDefaults?.permissionMode).toBeUndefined();
    const edits = { ...unset, permissionMode: 'acceptEdits' as const };
    expect(valuesToConfig(edits).taskDefaults?.permissionMode).toBe('acceptEdits');
  });
});

describe('appended system prompt', () => {
  it('round-trips it, and writes no session block when blank', () => {
    const v = configToValues({ session: { appendSystemPrompt: 'Use pnpm.' } }, fallbacks);
    expect(v.appendSystemPrompt).toBe('Use pnpm.');
    expect(valuesToConfig({ ...v, appendSystemPrompt: ' Be brief. ' }).session).toEqual({
      appendSystemPrompt: 'Be brief.',
    });
    expect(valuesToConfig({ ...v, appendSystemPrompt: '  ' }).session).toBeUndefined();
  });
});

describe('local-only defaults', () => {
  it('round-trips extra arguments and drops a blank line', () => {
    expect(localToValues({ extraArgs: '--chrome', addDirs: ['/a'] })).toEqual({
      extraArgs: '--chrome',
      addDirs: ['/a'],
    });
    expect(localToValues(undefined)).toEqual({ extraArgs: '', addDirs: [] });
    expect(valuesToLocal({ extraArgs: ' --chrome ', addDirs: [' /a', ''] })).toEqual({
      extraArgs: '--chrome',
      addDirs: ['/a'],
    });
    expect(valuesToLocal({ extraArgs: '  ', addDirs: [''] })).toEqual({
      extraArgs: undefined,
      addDirs: undefined,
    });
  });

  it("can't be saved with flags or folders a task couldn't launch with", () => {
    expect(localValuesOk({ extraArgs: '--chrome', addDirs: ['/a', ''] })).toBe(true);
    expect(localValuesOk({ extraArgs: '--settings x', addDirs: [] })).toBe(false);
    expect(localValuesOk({ extraArgs: '', addDirs: ['~/a'] })).toBe(false);
  });
});
