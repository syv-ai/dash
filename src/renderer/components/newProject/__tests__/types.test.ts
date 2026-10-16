import { describe, it, expect } from 'vitest';
import { configToValues, valuesToConfig } from '../types';

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
