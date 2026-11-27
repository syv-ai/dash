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

describe('local-only defaults', () => {
  it('round-trips extra arguments and drops a blank line', () => {
    expect(localToValues({ extraArgs: '--chrome' })).toEqual({ extraArgs: '--chrome' });
    expect(localToValues(undefined)).toEqual({ extraArgs: '' });
    expect(valuesToLocal({ extraArgs: ' --chrome ' })).toEqual({ extraArgs: '--chrome' });
    expect(valuesToLocal({ extraArgs: '  ' })).toEqual({ extraArgs: undefined });
  });

  it("can't be saved with extra arguments a task couldn't launch with", () => {
    expect(localValuesOk({ extraArgs: '--chrome' })).toBe(true);
    expect(localValuesOk({ extraArgs: '--settings x' })).toBe(false);
  });
});
