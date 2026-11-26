import { app } from 'electron';
import { PostHog } from 'posthog-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { scrubText } from './telemetryScrub';
import type { DriftReport } from '../claudeContract/types';
import { claudeVersionFor } from '../claudeContract/claudeVersions';

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
const EXCEPTION_PROPERTIES = new Set(['$exception_message', '$exception_list', 'error_message']);

// ── Allowed Events ────────────────────────────────────────────
const ALLOWED_EVENTS = new Set([
  // App lifecycle
  'app_started',
  'app_closed',
  'app_session',
  'daily_active_user',

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

  // Review and editor
  'review_mode_entered',
  'review_mode_exited',
  'pr_review_submitted',
  'file_opened',

  // Claude Code updates
  'claude_update_detected',
  'claude_update_restart_requested',

  // Errors
  '$exception',

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
  'error_message',
  'severity',
  '$exception_type',
  '$exception_message',
  '$exception_list',
]);

// ── Persisted State ───────────────────────────────────────────
interface TelemetryConfig {
  instanceId: string;
  enabled: boolean;
  lastActiveDate: string | null;
}

// ── Service ───────────────────────────────────────────────────
export class TelemetryService {
  private static client: PostHog | null = null;
  private static config: TelemetryConfig | null = null;
  private static startTime: number = 0;
  private static dailyTimer: ReturnType<typeof setInterval> | null = null;

  static initialize(): void {
    try {
      this.startTime = Date.now();
      this.config = this.readConfig();

      if (!this.isEnabled()) return;

      this.client = createClient();

      this.capture('app_started');
      this.checkDailyActiveUser();
      this.dailyTimer = setInterval(() => this.checkDailyActiveUser(), DAILY_CHECK_MS);
      this.dailyTimer.unref?.();
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

  static async shutdown(): Promise<void> {
    try {
      if (!this.client || !this.config) return;

      if (this.isEnabled()) {
        const duration = Date.now() - this.startTime;
        this.capture('app_session', { session_duration_ms: duration });
        this.capture('app_closed');
      }

      if (this.dailyTimer) clearInterval(this.dailyTimer);
      this.dailyTimer = null;
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

  private static writeConfig(config: TelemetryConfig): void {
    try {
      fs.writeFileSync(this.getConfigPath(), JSON.stringify(config, null, 2));
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

      if (EXCEPTION_PROPERTIES.has(key)) {
        result[key] = scrubException(value);
      } else if (typeof value === 'string') {
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

  private static checkDailyActiveUser(): void {
    if (!this.config) return;
    const today = new Date().toISOString().split('T')[0]!;
    if (this.config.lastActiveDate === today) return;

    this.config.lastActiveDate = today;
    this.writeConfig(this.config);

    this.capture('daily_active_user', {
      date: today,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }
}

function createClient(): PostHog {
  return new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    flushAt: 10,
    flushInterval: 30_000,
  });
}

/** An exception message, or an `$exception_list`, with user data scrubbed (telemetryScrub). */
function scrubException(value: unknown): unknown {
  const scrub = (s: string) => scrubText(s, { home: os.homedir() }).slice(0, MAX_EXCEPTION_LENGTH);
  if (typeof value === 'string') return scrub(value);
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (typeof item === 'string') return scrub(item);
    if (typeof item !== 'object' || item === null) return item;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (typeof v === 'string') safe[k] = scrub(v);
      else if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
    }
    return safe;
  });
}
