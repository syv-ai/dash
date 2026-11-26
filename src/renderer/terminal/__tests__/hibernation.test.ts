import { describe, expect, it } from 'vitest';
import {
  HIBERNATE_AFTER_MS,
  hibernateAfterMs,
  shouldHibernate,
  sweepEveryMs,
  type TerminalRest,
} from '../hibernation';

const NOW = 10_000_000;

/** A task's agent terminal, hidden just past the threshold. */
const resting = (over: Partial<TerminalRest> = {}): TerminalRest => ({
  taskPane: true,
  shown: false,
  hiddenAt: NOW - HIBERNATE_AFTER_MS - 1,
  busy: false,
  remoteControl: false,
  ...over,
});

describe('shouldHibernate', () => {
  it('hibernates a task terminal unseen for longer than the threshold', () => {
    expect(shouldHibernate(resting(), NOW)).toBe(true);
  });

  it('keeps one hidden for exactly the threshold or less', () => {
    expect(shouldHibernate(resting({ hiddenAt: NOW - HIBERNATE_AFTER_MS }), NOW)).toBe(false);
    expect(shouldHibernate(resting({ hiddenAt: NOW - 60_000 }), NOW)).toBe(false);
  });

  it('never hibernates the terminal on screen (the open task)', () => {
    expect(shouldHibernate(resting({ shown: true }), NOW)).toBe(false);
  });

  it('leaves drawer shells, side-car TUIs, service tabs and foreign sessions alone', () => {
    expect(shouldHibernate(resting({ taskPane: false }), NOW)).toBe(false);
  });

  it('waits out a restart or reconnect in flight', () => {
    expect(shouldHibernate(resting({ busy: true }), NOW)).toBe(false);
  });

  it('keeps a task with remote control on (its state is tied to the attach client)', () => {
    expect(shouldHibernate(resting({ remoteControl: true }), NOW)).toBe(false);
  });

  it('takes the threshold as an argument (the dev override)', () => {
    expect(shouldHibernate(resting({ hiddenAt: NOW - 5_001 }), NOW, 5_000)).toBe(true);
  });
});

describe('hibernateAfterMs', () => {
  it('is 15 minutes without an override', () => {
    expect(HIBERNATE_AFTER_MS).toBe(15 * 60_000);
    expect(hibernateAfterMs(undefined)).toBe(HIBERNATE_AFTER_MS);
  });

  it('takes a positive whole number of ms as the override', () => {
    expect(hibernateAfterMs('20000')).toBe(20_000);
  });

  it('ignores an override that is not a positive number', () => {
    for (const bad of ['', 'abc', '0', '-5', 'NaN']) {
      expect(hibernateAfterMs(bad)).toBe(HIBERNATE_AFTER_MS);
    }
  });
});

describe('sweepEveryMs', () => {
  it('checks once a minute at the real threshold', () => {
    expect(sweepEveryMs(HIBERNATE_AFTER_MS)).toBe(60_000);
  });

  it('checks often enough for a short dev threshold', () => {
    expect(sweepEveryMs(20_000)).toBe(5_000);
  });
});
