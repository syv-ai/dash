import { app } from 'electron';
import { PostHog, type BeforeSendFn } from 'posthog-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { ErrorThrottle } from './errorThrottle';
import { writeFileAtomic } from '../utils/atomicWrite';
import { scrubText } from './telemetryScrub';
import type { DriftReport } from '../claudeContract/types';
import { claudeVersionFor } from '../claudeContract/claudeVersions';
import { countBucket, minutesBucket } from './telemetryBuckets';
import { UsageLedger, type UsageLedgerState } from './usageLedger';
import { installedUpdate } from './autoUpdateTelemetry';

// ── Config ────────────────────────────────────────────────────
const POSTHOG_KEY = 'phc_zEKzF3cpq9lpt1x3ONeDemYkilhWjC1XgZSGN6AyX01';
const POSTHOG_HOST = 'https://eu.i.posthog.com';
const CONFIG_FILE = 'telemetry.json';
const MAX_STRING_LENGTH = 100;
/** Exception messages and stacks are scrubbed first, then capped here. */
const MAX_EXCEPTION_LENGTH = 2_000;
const MAX_NUMBER = 1_000_000;
/** Dash runs for days; the daily-active check runs this often, not only at launch. */
const DAILY_CHECK_MS = 60 * 60 * 1000;
/** Quit waits this long for queued events (main.ts's safety net is 8 s). */
const SHUTDOWN_TIMEOUT_MS = 3_000;
/** A focused window counts one active minute per tick. */
const ACTIVE_TICK_MS = 60_000;
/** The first usage snapshot waits for the supervisor's listing to fill in the sessions. */
const SNAPSHOT_DELAY_MS = 5 * 60_000;

// ── Allowed Events ────────────────────────────────────────────
const ALLOWED_EVENTS = new Set([
  // App lifecycle
  'app_started',
  'app_closed',
  'app_session',
  'daily_active_user',
  'usage_snapshot',

  // Projects
  'project_added',
  'project_deleted',
  'project_archived',
  'project_restored',

  // Tasks
  'task_created',
  'task_deleted',
  'task_archived',
  'task_restored',

  // Features
  'worktree_created',
  'worktree_created_existing_branch',
  'worktree_removed',
  'worktree_migrated',
  'terminal_started',
  'session_adopted',

  // Sessions and turns (docs/telemetry.md)
  'session_started',
  'session_woken',
  'session_slept',
  'session_restarted',
  'turn_completed',
  'turn_failed',
  'wait_ended',
  'first_turn_started',

  // Review and editor
  'review_mode_entered',
  'review_mode_exited',
  'pr_review_submitted',
  'file_opened',

  // Task outcomes (renderer, from PR polling)
  'pr_opened',
  'branch_merged',

  // Claude Code updates
  'claude_update_detected',
  'claude_update_restart_requested',

  // Setup
  'claude_cli_missing',

  // Dash's own updates (AutoUpdateService)
  'app_update_available',
  'app_update_downloaded',
  'app_update_installed',
  'app_update_failed',

  // Feature use
  'project_switched',
  'sidebar_mode_changed',
  'terminal_drawer_opened',
  'task_finder_opened',
  'dashctl_called',
  'lsp_failed',

  // System health (SystemHealthService; the action from the renderer)
  'memory_warning_shown',
  'memory_warning_acted',

  // Errors ($exception goes through captureException, not this list)
  'ipc_failed',

  // Claude Code behaving differently than Dash expects (claudeContract/)
  'claude_contract_drift',
]);

// ── Allowed Properties ────────────────────────────────────────
const ALLOWED_PROPERTIES = new Set([
  'app_version',
  'platform',
  'arch',
  'is_dev',
  'project_count',
  'task_count',
  'date',
  'timezone',
  'duration_ms',
  'session_duration_ms',
  'source',
  'kind',
  'claude_version',
  'field_path',
  'enum_value',
  'duration_bucket',
  'interrupted',
  'resumed',
  'model',
  'permission_mode',
  'provider',
  'verdict',
  'comment_count',
  'ok',
  'mode',
  'outdated_count',
  'moved',
  'removed',
  'failed',
  'error_type',
  'error_code',
  'channel',
  'severity',
  'reason',
  'tool_call_bucket',
  'subagent_used',
  'active_minutes_bucket',
  'open_task_count',
  'live_session_count',
  'peak_busy_sessions',
  'from_version',
  'to_version',
  'stage',
  'command',
  'language_id',
  'memory_bucket',
]);

// ── Persisted State ───────────────────────────────────────────
interface TelemetryConfig {
  instanceId: string;
  enabled: boolean;
  lastActiveDate: string | null;
  /** The day `usage_snapshot` last went (UTC date). */
  lastSnapshotDate?: string | null;
  /** Active minutes and peak busy sessions (UsageLedger), saved as they change. */
  usage?: UsageLedgerState;
  /** The Dash version of the last launch, for `app_update_installed`. */
  lastVersion?: string;
}

/** What main tells telemetry about the app, for the daily usage reports. */
export interface UsageSource {
  /** Open projects, and open tasks in them (archived ones left out). */
  counts(): { projects: number; openTasks: number };
  /** A Dash window has focus. */
  isForeground(): boolean;
}

// ── Service ───────────────────────────────────────────────────
export class TelemetryService {
  private static client: PostHog | null = null;
  private static config: TelemetryConfig | null = null;
  private static startTime: number = 0;
  private static dailyTimer: ReturnType<typeof setInterval> | null = null;
  private static activeTimer: ReturnType<typeof setInterval> | null = null;
  private static usage = new UsageLedger();
  private static usageSource: UsageSource | null = null;
  private static liveSessions = 0;
  /** `captureDaily` keys sent, by day. */
  private static dailySent = new Set<string>();
  /** One report per error per minute, 30 an hour in all. */
  private static readonly errors = new ErrorThrottle({ windowMs: 60_000, maxPerHour: 30 });

  static initialize(): void {
    try {
      this.startTime = Date.now();
      this.config = this.readConfig();
      this.usage = new UsageLedger(this.config.usage);
      // Kept whether or not telemetry is on, so turning it on later doesn't
      // report every version since as one jump.
      const lastVersion = this.config.lastVersion;
      if (lastVersion !== app.getVersion()) {
        this.config.lastVersion = app.getVersion();
        this.writeConfig(this.config);
      }

      if (!this.isEnabled()) return;

      this.client = createClient();

      this.capture('app_started');
      const installed = installedUpdate(lastVersion, app.getVersion());
      if (installed) this.capture(installed.event, installed.properties);
      this.checkDailyActiveUser();
      this.dailyTimer = setInterval(() => {
        this.checkDailyActiveUser();
        this.checkUsageSnapshot();
      }, DAILY_CHECK_MS);
      this.dailyTimer.unref?.();
      this.activeTimer = setInterval(() => this.tickActive(), ACTIVE_TICK_MS);
      this.activeTimer.unref?.();
    } catch {
      // Telemetry must never crash the app
    }
  }

  /** Queue an event; true when it was queued (telemetry on, event allowed). */
  static capture(event: string, properties?: Record<string, unknown>): boolean {
    try {
      if (!this.client || !this.config || !this.isEnabled()) return false;
      if (!ALLOWED_EVENTS.has(event)) return false;

      const sanitized = this.sanitizeProperties(properties);
      const baseProps = this.getBaseProperties();

      this.client.capture({
        distinctId: this.config.instanceId,
        event,
        properties: { ...baseProps, ...sanitized },
      });
      return true;
    } catch {
      // Silently swallow
      return false;
    }
  }

  /**
   * An error, as PostHog error tracking's `$exception` (posthog-node parses
   * the stack). Throttled (`errors`); every string, stack frames included,
   * is scrubbed of user data by the client's `before_send`.
   */
  static captureException(error: unknown, properties: Record<string, unknown> = {}): boolean {
    try {
      if (!this.client || !this.config || !this.isEnabled()) return false;
      const err = error instanceof Error ? error : new Error(String(error));
      const key = `${String(properties.source ?? '')}:${err.name}:${scrub(err.message)}`;
      if (!this.errors.allow(key, Date.now())) return false;
      this.client.captureException(err, this.config.instanceId, {
        ...this.getBaseProperties(),
        ...this.sanitizeProperties(properties),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * At most once a day per `key` (in memory: a restart may send it again),
   * for events whose every occurrence would only be volume.
   */
  static captureDaily(key: string, event: string, properties?: Record<string, unknown>): boolean {
    const dayKey = `${today()}:${key}`;
    if (this.dailySent.has(dayKey)) return false;
    const sent = this.capture(event, properties);
    if (sent) this.dailySent.add(dayKey);
    return sent;
  }

  /** An IPC handler that answered with a failure: its channel and error code, no message. */
  static captureIpcFailure(channel: string, errorCode: string): boolean {
    if (!this.errors.allow(`ipc:${channel}:${errorCode}`, Date.now())) return false;
    return this.capture('ipc_failed', { channel, error_code: errorCode });
  }

  /**
   * One Claude Code contract drift, shape only: where (source, field path),
   * how (kind), under which Claude Code version, and an unknown enum member
   * when it is identifier-shaped. Sent once per key ever (driftReporter).
   */
  static captureDrift(report: DriftReport): boolean {
    return this.capture('claude_contract_drift', {
      claude_version: report.claudeVersion,
      source: report.source,
      kind: report.kind,
      field_path: report.path,
      ...(report.value ? { enum_value: report.value } : {}),
    });
  }

  /**
   * Main's view of the app for the daily usage reports (main.ts, once the
   * database and window are up); the first snapshot follows a few minutes
   * later, once the sessions are known.
   */
  static setUsageSource(source: UsageSource): void {
    this.usageSource = source;
    if (!this.client) return;
    setTimeout(() => this.checkUsageSnapshot(), SNAPSHOT_DELAY_MS).unref?.();
  }

  /** ActivityMonitor's latest counts: live sessions, and the busy ones for the day's peak. */
  static noteSessions(counts: { live: number; busy: number }): void {
    try {
      if (!this.client || !this.config) return;
      this.liveSessions = counts.live;
      if (this.usage.noteBusy(counts.busy, today())) this.saveUsage();
    } catch {
      // Telemetry must never crash the app
    }
  }

  static async shutdown(): Promise<void> {
    try {
      if (!this.client || !this.config) return;

      if (this.isEnabled()) {
        const duration = Date.now() - this.startTime;
        this.capture('app_session', { session_duration_ms: duration });
        this.capture('app_closed');
      }

      if (this.dailyTimer) clearInterval(this.dailyTimer);
      if (this.activeTimer) clearInterval(this.activeTimer);
      this.dailyTimer = null;
      this.activeTimer = null;
      await this.client.shutdown(SHUTDOWN_TIMEOUT_MS);
      this.client = null;
    } catch {
      // Silently swallow
    }
  }

  /**
   * On when the user hasn't opted out, and only in the packaged app: a dev
   * or test run sends nothing, whatever its telemetry.json says (a dev
   * folder copied from the installed app carries `enabled: true`), unless
   * `TELEMETRY_ENABLED=true` asks for it. `TELEMETRY_ENABLED=false` always wins.
   */
  static isEnabled(): boolean {
    if (process.env.TELEMETRY_ENABLED === 'false') return false;
    if (!app.isPackaged && process.env.TELEMETRY_ENABLED !== 'true') return false;
    return this.config?.enabled !== false;
  }

  static setEnabled(enabled: boolean): void {
    try {
      if (!this.config) this.config = this.readConfig();
      this.config.enabled = enabled;
      this.writeConfig(this.config);

      if (enabled && !this.client && this.isEnabled()) {
        this.client = createClient();
      } else if (!enabled && this.client) {
        this.client.shutdown().catch(() => {});
        this.client = null;
      }
    } catch {
      // Silently swallow
    }
  }

  static getStatus(): { enabled: boolean; envDisabled: boolean } {
    return {
      enabled: this.config?.enabled !== false,
      envDisabled: process.env.TELEMETRY_ENABLED === 'false',
    };
  }

  // ── Private ───────────────────────────────────────────────

  private static getConfigPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE);
  }

  private static readConfig(): TelemetryConfig {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {
      // Corrupted config — regenerate
    }

    const config: TelemetryConfig = {
      instanceId: crypto.randomUUID(),
      // A dev run (its own Dash-dev folder) sends nothing unless turned on.
      enabled: app.isPackaged,
      lastActiveDate: null,
    };
    this.writeConfig(config);
    return config;
  }

  /** Atomic: the usage ledger rewrites it every active minute, and a torn file would mint a new instanceId. */
  private static writeConfig(config: TelemetryConfig): void {
    try {
      writeFileAtomic(this.getConfigPath(), JSON.stringify(config, null, 2));
    } catch {
      // Best effort
    }
  }

  private static getBaseProperties(): Record<string, unknown> {
    return {
      app_version: app.getVersion(),
      platform: process.platform,
      arch: os.arch(),
      is_dev: process.argv.includes('--dev'),
      // The installed Claude Code (`M.m.p`), for the version mix.
      claude_version: claudeVersionFor(),
    };
  }

  private static sanitizeProperties(props?: Record<string, unknown>): Record<string, unknown> {
    if (!props) return {};

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!ALLOWED_PROPERTIES.has(key)) continue;

      if (typeof value === 'string') {
        result[key] = value.slice(0, MAX_STRING_LENGTH);
      } else if (typeof value === 'number') {
        result[key] = Math.min(Math.max(value, 0), MAX_NUMBER);
      } else if (typeof value === 'boolean') {
        result[key] = value;
      }
      // Objects and other types are dropped
    }
    return result;
  }

  /**
   * The first check of a day. `active_minutes_bucket` is the last closed
   * day's (this day has barely started), read from the saved ledger, so a
   * day that ended in a crash still counts.
   */
  private static checkDailyActiveUser(): void {
    if (!this.config) return;
    const date = today();
    if (this.config.lastActiveDate === date) return;

    this.config.lastActiveDate = date;
    this.usage.rollTo(date);
    this.saveUsage();

    const closed = this.usage.finished;
    this.capture('daily_active_user', {
      date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(closed ? { active_minutes_bucket: minutesBucket(closed.activeMinutes) } : {}),
    });
  }

  /**
   * At most once a day: how much Dash holds now (projects, open tasks, live
   * sessions) and the last closed day's peak of sessions working at once.
   */
  private static checkUsageSnapshot(): void {
    try {
      if (!this.config || !this.usageSource) return;
      const date = today();
      if (this.config.lastSnapshotDate === date) return;
      const { projects, openTasks } = this.usageSource.counts();
      const closed = this.usage.finished;
      const sent = this.capture('usage_snapshot', {
        project_count: countBucket(projects),
        open_task_count: countBucket(openTasks),
        live_session_count: countBucket(this.liveSessions),
        ...(closed ? { peak_busy_sessions: countBucket(closed.peakBusy) } : {}),
      });
      if (!sent) return;
      this.config.lastSnapshotDate = date;
      this.usage.clearFinished();
      this.saveUsage();
    } catch {
      // Telemetry must never crash the app
    }
  }

  private static tickActive(): void {
    try {
      if (!this.config || !this.usageSource?.isForeground()) return;
      this.usage.addActiveMinute(today());
      this.saveUsage();
    } catch {
      // Telemetry must never crash the app
    }
  }

  private static saveUsage(): void {
    if (!this.config) return;
    this.config.usage = this.usage.toJSON();
    this.writeConfig(this.config);
  }
}

/** Today as `YYYY-MM-DD`, UTC (the date `daily_active_user` has always used). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function createClient(): PostHog {
  return new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    flushAt: 10,
    flushInterval: 30_000,
    before_send: scrubExceptionEvent,
  });
}

const scrub = (s: string) => scrubText(s, { home: os.homedir() }).slice(0, MAX_EXCEPTION_LENGTH);

/** Every string in an `$exception` event (message, stack frames, paths) scrubbed of user data. */
export const scrubExceptionEvent: BeforeSendFn = (event) => {
  if (event.event !== '$exception' || !event.properties) return event;
  return { ...event, properties: scrubDeep(event.properties, 0) as typeof event.properties };
};

function scrubDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrub(value);
  if (depth > 8 || typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubDeep(v, depth + 1)]),
  );
}
