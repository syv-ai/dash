import { z } from 'zod';
import { DRIFT_KINDS, type DriftReport } from './types';

/** One drift as the local log keeps it: when first and last seen, how often, whether PostHog has it. */
export interface DriftRecord extends DriftReport {
  firstSeen: string;
  lastSeen: string;
  count: number;
  /** Sent to PostHog under this key; a later run doesn't send it again. */
  sent: boolean;
}

const recordSchema = z.object({
  claudeVersion: z.string(),
  source: z.string(),
  kind: z.enum(DRIFT_KINDS),
  path: z.string(),
  value: z.string().optional(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  count: z.number().int().positive(),
  sent: z.boolean(),
});

const keyOf = (r: DriftReport) =>
  [r.claudeVersion, r.source, r.kind, r.path, r.value ?? ''].join('\0');

/**
 * The drift seen so far, deduplicated on (version, source, kind, path,
 * value). Pure: the caller supplies the time and does the I/O. A drift is
 * sent once per key ever (`sent` survives runs through the log) and logged on
 * every sighting (count, last seen).
 */
export class DriftLedger {
  private readonly byKey = new Map<string, DriftRecord>();
  private readonly seenThisRun = new Set<string>();

  constructor(records: readonly DriftRecord[] = []) {
    for (const r of records) this.byKey.set(keyOf(r), { ...r });
  }

  /** Record one sighting. `send` is true the first time this run for a key never sent. */
  observe(report: DriftReport, now: string): { firstThisRun: boolean; send: boolean } {
    const key = keyOf(report);
    const known = this.byKey.get(key);
    const record: DriftRecord = known
      ? { ...known, lastSeen: now, count: known.count + 1 }
      : { ...report, firstSeen: now, lastSeen: now, count: 1, sent: false };
    this.byKey.set(key, record);
    const firstThisRun = !this.seenThisRun.has(key);
    this.seenThisRun.add(key);
    return { firstThisRun, send: firstThisRun && !record.sent };
  }

  markSent(report: DriftReport): void {
    const record = this.byKey.get(keyOf(report));
    if (record) record.sent = true;
  }

  records(): DriftRecord[] {
    return [...this.byKey.values()];
  }

  /**
   * The log as JSONL, newest sighting first, cut at `maxBytes`; what didn't
   * fit goes to `evicted` (the rotated file).
   */
  serialize(maxBytes: number): { current: string; evicted: string } {
    const sorted = this.records().sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    let current = '';
    let evicted = '';
    for (const r of sorted) {
      const line = `${JSON.stringify(r)}\n`;
      if (evicted === '' && Buffer.byteLength(current) + Buffer.byteLength(line) <= maxBytes) {
        current += line;
      } else {
        evicted += line;
      }
    }
    return { current, evicted };
  }
}

/** Records from a log's text; unreadable lines are skipped, a later line for a key wins. */
export function parseDriftLog(text: string): DriftRecord[] {
  const byKey = new Map<string, DriftRecord>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) continue;
    const record = parsed.data as DriftRecord;
    byKey.set(keyOf(record), record);
  }
  return [...byKey.values()];
}
