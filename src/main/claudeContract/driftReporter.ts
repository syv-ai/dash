import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic } from '../utils/atomicWrite';
import { DriftLedger, parseDriftLog } from './driftLedger';
import type { DriftFinding, DriftReport, DriftSource } from './types';

/** The local drift log, in Dash's data folder. */
export const DRIFT_LOG_FILE = 'claude-drift.jsonl';
/** What a full log rotates into (replaced on each rotation). */
export const DRIFT_LOG_ROTATED_FILE = 'claude-drift.1.jsonl';
const MAX_LOG_BYTES = 256 * 1024;
const FLUSH_DELAY_MS = 5_000;

export interface DriftReporterDeps {
  /** Dash's data folder; null keeps the ledger in memory only (no `app`, unit tests). */
  dir: string | null;
  /** Hands a new drift to PostHog; true when it was queued (telemetry on). */
  send: (report: DriftReport) => boolean;
  now?: () => Date;
  flushDelayMs?: number;
  maxLogBytes?: number;
}

/**
 * Takes drift reports from every boundary: counts them in the ledger, sends
 * each new one to PostHog once, and writes the log a few seconds later (one
 * write for a burst; a hook that drifts on every call only bumps a count).
 * Never throws: drift reporting must not break the path it watches.
 */
export class DriftReporter {
  private readonly ledger: DriftLedger;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DriftReporterDeps) {
    this.now = deps.now ?? (() => new Date());
    this.ledger = new DriftLedger(deps.dir ? readLogs(deps.dir) : []);
  }

  report(report: DriftReport): void {
    try {
      const { firstThisRun, send } = this.ledger.observe(report, this.now().toISOString());
      if (firstThisRun) {
        console.warn(
          `[claude-drift] ${report.source} ${report.kind} ${report.path}` +
            `${report.value ? `=${report.value}` : ''} (Claude Code ${report.claudeVersion})`,
        );
      }
      if (send && this.deps.send(report)) this.ledger.markSent(report);
      this.scheduleFlush();
    } catch (err) {
      console.warn('[claude-drift] report failed:', err);
    }
  }

  /** Write the log now (quit, tests). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const dir = this.deps.dir;
    if (!dir) return;
    try {
      const { current, evicted } = this.ledger.serialize(this.deps.maxLogBytes ?? MAX_LOG_BYTES);
      fs.mkdirSync(dir, { recursive: true });
      if (evicted) writeFileAtomic(path.join(dir, DRIFT_LOG_ROTATED_FILE), evicted);
      writeFileAtomic(path.join(dir, DRIFT_LOG_FILE), current);
    } catch (err) {
      console.warn('[claude-drift] writing the log failed:', err);
    }
  }

  private scheduleFlush(): void {
    if (this.timer || !this.deps.dir) return;
    this.timer = setTimeout(() => this.flush(), this.deps.flushDelayMs ?? FLUSH_DELAY_MS);
    this.timer.unref?.();
  }
}

/** Both log files, so a drift rotated out still counts as sent. The current file wins. */
function readLogs(dir: string): ReturnType<typeof parseDriftLog> {
  const read = (name: string) => {
    try {
      return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      return '';
    }
  };
  return parseDriftLog(`${read(DRIFT_LOG_ROTATED_FILE)}\n${read(DRIFT_LOG_FILE)}`);
}

// ── The app's reporter ─────────────────────────────────────

let reporter: DriftReporter | null = null;

/**
 * Install the app's reporter (main.ts, at boot). Until then, and in unit
 * tests, reports are dropped.
 */
export function installDriftReporter(deps: DriftReporterDeps): DriftReporter {
  reporter?.flush();
  reporter = new DriftReporter(deps);
  return reporter;
}

export function reportDrift(report: DriftReport): void {
  reporter?.report(report);
}

/** Report each finding of one payload under its source and version. */
export function reportFindings(
  source: DriftSource,
  findings: readonly DriftFinding[],
  claudeVersion: string,
): void {
  for (const f of findings) reportDrift({ ...f, source, claudeVersion });
}

export function flushDriftLog(): void {
  reporter?.flush();
}
