import { describe, expect, it } from 'vitest';
import { DriftLedger, parseDriftLog } from '../driftLedger';
import type { DriftReport } from '../types';

const report = (over: Partial<DriftReport> = {}): DriftReport => ({
  claudeVersion: '2.1.332',
  source: 'hook:Stop',
  kind: 'unexpected-field',
  path: 'session_crons',
  ...over,
});

describe('DriftLedger', () => {
  it('sends a drift the first time it is seen, and counts every sighting', () => {
    const ledger = new DriftLedger();
    expect(ledger.observe(report(), 't1')).toEqual({ firstThisRun: true, send: true });
    ledger.markSent(report());
    expect(ledger.observe(report(), 't2')).toEqual({ firstThisRun: false, send: false });
    expect(ledger.records()).toEqual([
      { ...report(), firstSeen: 't1', lastSeen: 't2', count: 2, sent: true },
    ]);
  });

  it('keys on version, source, kind, path and value', () => {
    const ledger = new DriftLedger();
    ledger.observe(report(), 't');
    for (const other of [
      report({ claudeVersion: '2.1.333' }),
      report({ source: 'hook:SubagentStop' }),
      report({ kind: 'wrong-type' }),
      report({ path: 'background_tasks' }),
      report({ kind: 'unknown-enum-value', path: 'notification_type', value: 'a' }),
      report({ kind: 'unknown-enum-value', path: 'notification_type', value: 'b' }),
    ]) {
      expect(ledger.observe(other, 't').send).toBe(true);
    }
  });

  it('does not re-send a drift a past run already sent, but logs it again', () => {
    const past = new DriftLedger();
    past.observe(report(), 't1');
    past.markSent(report());
    const next = new DriftLedger(parseDriftLog(past.serialize(1_000_000).current));
    expect(next.observe(report(), 't2')).toEqual({ firstThisRun: true, send: false });
    expect(next.records()[0]).toMatchObject({ firstSeen: 't1', lastSeen: 't2', count: 2 });
  });

  it('sends later a drift seen while telemetry was off', () => {
    const past = new DriftLedger();
    past.observe(report(), 't1');
    const next = new DriftLedger(parseDriftLog(past.serialize(1_000_000).current));
    expect(next.observe(report(), 't2').send).toBe(true);
  });

  it('keeps the most recently seen records under the cap and rotates the rest out', () => {
    const ledger = new DriftLedger();
    ledger.observe(report({ path: 'old' }), '2026-01-01T00:00:00.000Z');
    ledger.observe(report({ path: 'new' }), '2026-02-01T00:00:00.000Z');
    const oneLine = ledger.serialize(1_000_000).current.split('\n')[0]!.length + 1;
    const { current, evicted } = ledger.serialize(oneLine);
    expect(parseDriftLog(current).map((r) => r.path)).toEqual(['new']);
    expect(parseDriftLog(evicted).map((r) => r.path)).toEqual(['old']);
  });

  it('skips lines it cannot read', () => {
    const good = new DriftLedger();
    good.observe(report(), 't');
    const text = `not json\n{"kind":"bogus"}\n${good.serialize(1_000_000).current}`;
    expect(parseDriftLog(text)).toHaveLength(1);
  });

  it('a later line for the same key wins when a log holds two', () => {
    const a = { ...report(), firstSeen: 't1', lastSeen: 't1', count: 1, sent: false };
    const b = { ...a, lastSeen: 't9', count: 5, sent: true };
    const ledger = new DriftLedger(parseDriftLog(`${JSON.stringify(a)}\n${JSON.stringify(b)}\n`));
    expect(ledger.records()).toEqual([b]);
  });
});
