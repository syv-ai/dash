import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { custom } = vi.hoisted(() => ({ custom: vi.fn() }));
vi.mock('sonner', () => ({ toast: { custom, dismiss: vi.fn() } }));
vi.mock('../Toaster', () => ({ ToastView: () => null }));
vi.mock('../../../stores/settingsStore', () => ({
  useSettings: { getState: () => ({ updateNotificationsEnabled: true }) },
}));

import { toast } from '../toast';
import { STICKY_OFFER_DURATION, TOAST_DURATION } from '../toastPolicy';

const action = { label: 'Use mine', onClick: () => {} };
const optionsOf = (call: number) =>
  custom.mock.calls[call]![1] as { id: string; duration: number; onDismiss?: () => void };

describe('toast.offer', () => {
  beforeEach(() => {
    custom.mockClear();
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    vi.stubGlobal('document', { hasFocus: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lasts the offer duration, or until closed when sticky', () => {
    toast.offer('Plain', { action });
    toast.offer('Sticky', { action, sticky: true });
    expect(optionsOf(0).duration).toBe(TOAST_DURATION.offer);
    expect(optionsOf(1).duration).toBe(STICKY_OFFER_DURATION);
    expect(STICKY_OFFER_DURATION).toBe(Infinity);
  });

  it('hands sonner the onDismiss, under the key it collapses by', () => {
    const onDismiss = vi.fn();
    toast.offer('Held', { action, key: 'task-notice-t1', onDismiss });
    expect(optionsOf(0)).toMatchObject({ id: 'task-notice-t1', onDismiss });
  });
});
