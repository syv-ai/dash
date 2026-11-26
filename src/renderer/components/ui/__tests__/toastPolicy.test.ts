import { describe, expect, it } from 'vitest';
import type { ToastPayload } from '@shared/toast';
import {
  TOAST_DURATION,
  copiedContent,
  createFocusGate,
  fromPayload,
  toastId,
  type ToastVariant,
} from '../toastPolicy';

describe('toastPolicy', () => {
  it('durations: every variant has a duration; error outlasts warning outlasts info outlasts success outlasts copied; progress is Infinity', () => {
    const variants: ToastVariant[] = [
      'info',
      'success',
      'warning',
      'error',
      'copied',
      'offer',
      'progress',
    ];
    for (const v of variants) expect(TOAST_DURATION[v]).toBeGreaterThan(0);
    const d = TOAST_DURATION;
    expect(d.error).toBeGreaterThan(d.warning);
    expect(d.warning).toBeGreaterThan(d.info);
    expect(d.info).toBeGreaterThan(d.success);
    expect(d.success).toBeGreaterThan(d.copied);
    expect(d.progress).toBe(Infinity);
  });

  it("toastId: same kind and title give the same id; a key wins over the title; different kinds don't collide", () => {
    expect(toastId('error', 'Save failed')).toBe(toastId('error', 'Save failed'));
    expect(toastId('error', 'Save failed', 'k')).toBe('k');
    expect(toastId('error', 'Other', 'k')).toBe(toastId('error', 'Save failed', 'k'));
    expect(toastId('error', 'Save failed')).not.toBe(toastId('warning', 'Save failed'));
  });

  it('copiedContent: "Copied path" with the path as description; drops the description above 80 chars', () => {
    expect(copiedContent('path', 'src/a.ts')).toEqual({
      title: 'Copied path',
      description: 'src/a.ts',
    });
    const long = 'x'.repeat(81);
    expect(copiedContent('message', long)).toEqual({ title: 'Copied message' });
    expect(copiedContent('message', 'x'.repeat(80)).description).toHaveLength(80);
  });

  it('fromPayload: an error payload maps to kind error, 8000ms, id from key or title; a link survives; unknown kind falls back to info', () => {
    const link = { type: 'openUrl', label: 'Open', url: 'https://x' } as const;
    const err = fromPayload({
      kind: 'error',
      title: 'Teardown failed',
      description: 'boom',
      action: link,
    });
    expect(err).toMatchObject({
      kind: 'error',
      title: 'Teardown failed',
      description: 'boom',
      duration: 8000,
      link,
    });
    expect(err.id).toBe(toastId('error', 'Teardown failed'));
    expect(fromPayload({ kind: 'error', title: 't', key: 'service:web' }).id).toBe('service:web');
    const future = fromPayload({ kind: 'celebrate', title: 'New' } as unknown as ToastPayload);
    expect(future).toMatchObject({ kind: 'info', duration: TOAST_DURATION.info });
  });

  it('createFocusGate: runs at once when focused; queues while unfocused; flush runs queued fns in order, once; dedupes nothing', () => {
    let focused = true;
    const gate = createFocusGate(() => focused);
    const ran: string[] = [];
    gate.run(() => ran.push('now'));
    expect(ran).toEqual(['now']);

    focused = false;
    gate.run(() => ran.push('a'));
    gate.run(() => ran.push('b'));
    gate.run(() => ran.push('b'));
    expect(ran).toEqual(['now']);
    expect(gate.size()).toBe(3);

    focused = true;
    gate.flush();
    gate.flush();
    expect(ran).toEqual(['now', 'a', 'b', 'b']);
    expect(gate.size()).toBe(0);
  });
});
