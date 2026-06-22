import { describe, it, expect } from 'vitest';
import { statusContent } from '../statusContent';
import type { ActivityInfo } from '../../../../shared/types';

describe('statusContent', () => {
  it('renders no-task fallback when activity is undefined', () => {
    expect(statusContent(undefined)).toEqual({
      label: 'No active task',
      tone: 'muted',
    });
  });

  it('shows tool label when busy with a tool', () => {
    const a: ActivityInfo = {
      state: 'busy',
      tool: { toolName: 'Edit', label: 'Editing src/auth/middleware.ts' },
    };
    expect(statusContent(a)).toEqual({
      label: 'Editing src/auth/middleware.ts',
      tone: 'busy',
    });
  });

  it('shows "Working" when busy with no tool', () => {
    expect(statusContent({ state: 'busy' })).toEqual({ label: 'Working', tone: 'busy' });
  });

  it('shows "Compacting context…" when busy and compacting', () => {
    const a: ActivityInfo = { state: 'busy', compacting: true };
    expect(statusContent(a)).toEqual({ label: 'Compacting context…', tone: 'busy' });
  });

  it('shows "Waiting for input" when state is waiting', () => {
    expect(statusContent({ state: 'waiting' })).toEqual({
      label: 'Waiting for input',
      tone: 'waiting',
    });
  });

  it('shows the error type label when state is error', () => {
    expect(statusContent({ state: 'error', error: { type: 'rate_limit' } })).toEqual({
      label: 'Rate limited',
      tone: 'error',
    });
    expect(statusContent({ state: 'error', error: { type: 'auth_error' } })).toEqual({
      label: 'Authentication error',
      tone: 'error',
    });
    expect(statusContent({ state: 'error', error: { type: 'billing_error' } })).toEqual({
      label: 'Billing error',
      tone: 'error',
    });
    expect(statusContent({ state: 'error' })).toEqual({
      label: 'Error',
      tone: 'error',
    });
  });

  it('shows "Idle" when state is idle', () => {
    expect(statusContent({ state: 'idle' })).toEqual({
      label: 'Idle',
      tone: 'idle',
    });
  });
});
