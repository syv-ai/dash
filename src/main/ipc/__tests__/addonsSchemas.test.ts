import { describe, it, expect } from 'vitest';
import {
  actionSchema,
  setEnabledSchema,
  surfacesSchema,
  terminalClosedSchema,
} from '../addonsSchemas';

describe('addons IPC schemas', () => {
  it('accepts well-formed payloads', () => {
    expect(setEnabledSchema.safeParse({ id: 'rtk', enabled: true }).success).toBe(true);
    expect(surfacesSchema.safeParse({ taskId: null }).success).toBe(true);
    expect(surfacesSchema.safeParse({ taskId: 't1' }).success).toBe(true);
    expect(
      actionSchema.safeParse({
        addonId: 'ports',
        ref: { surface: 'drawer', taskId: 't1' },
        actionId: 'start',
      }).success,
    ).toBe(true);
    expect(terminalClosedSchema.safeParse({ taskId: 't1', tabId: 'x' }).success).toBe(true);
  });

  it('rejects an unknown surface', () => {
    expect(
      actionSchema.safeParse({ addonId: 'ports', ref: { surface: 'card' }, actionId: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a missing add-on id', () => {
    expect(actionSchema.safeParse({ ref: { surface: 'drawer' }, actionId: 'x' }).success).toBe(
      false,
    );
    expect(setEnabledSchema.safeParse({ enabled: true }).success).toBe(false);
  });

  it('requires taskId to be present, even if null', () => {
    expect(surfacesSchema.safeParse({}).success).toBe(false);
  });
});
