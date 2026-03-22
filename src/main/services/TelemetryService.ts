import { app } from 'electron';
import { PostHog } from 'posthog-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';

// ── Config ────────────────────────────────────────────────────
const POSTHOG_KEY = 'phc_zEKzF3cpq9lpt1x3ONeDemYkilhWjC1XgZSGN6AyX01';
const POSTHOG_HOST = 'https://eu.i.posthog.com';
const CONFIG_FILE = 'telemetry.json';
const MAX_STRING_LENGTH = 100;
const MAX_NUMBER = 1_000_000;

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

  // Tasks
  'task_created',
  'task_deleted',
  'task_archived',
  'task_restored',

  // Features
  'worktree_created',
  'worktree_removed',
  'terminal_started',
  'settings_changed',

  // Errors
  '$exception',
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
  'setting',
  'value',
  'source',
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

  static initialize(): void {
    try {
      this.startTime = Date.now();
      this.config = this.readConfig();

      if (!this.isEnabled()) return;

      this.client = new PostHog(POSTHOG_KEY, {
        host: POSTHOG_HOST,
        flushAt: 10,
        flushInterval: 30_000,
      });

      this.capture('app_started');
      this.checkDailyActiveUser();
    } catch {
      // Telemetry must never crash the app
    }
  }

  static capture(event: string, properties?: Record<string, unknown>): void {
    try {
      if (!this.client || !this.config || !this.isEnabled()) return;
      if (!ALLOWED_EVENTS.has(event)) return;

      const sanitized = this.sanitizeProperties(properties);
      const baseProps = this.getBaseProperties();

      this.client.capture({
        distinctId: this.config.instanceId,
        event,
        properties: { ...baseProps, ...sanitized },
      });
    } catch {
      // Silently swallow
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

      await this.client.shutdown();
      this.client = null;
    } catch {
      // Silently swallow
    }
  }

  static isEnabled(): boolean {
    // Env var override
    if (process.env.TELEMETRY_ENABLED === 'false') return false;
    return this.config?.enabled !== false;
  }

  static setEnabled(enabled: boolean): void {
    try {
      if (!this.config) this.config = this.readConfig();
      this.config.enabled = enabled;
      this.writeConfig(this.config);

      if (enabled && !this.client) {
        this.client = new PostHog(POSTHOG_KEY, {
          host: POSTHOG_HOST,
          flushAt: 10,
          flushInterval: 30_000,
        });
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
      enabled: true,
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
      } else if (Array.isArray(value)) {
        // Allow arrays (e.g. $exception_list) but sanitize string entries
        result[key] = value.map((item) => {
          if (typeof item === 'string') return item.slice(0, MAX_STRING_LENGTH);
          if (typeof item === 'object' && item !== null) return sanitizeExceptionEntry(item);
          return item;
        });
      }
      // Objects and other types are dropped
    }
    return result;
  }

  private static checkDailyActiveUser(): void {
    if (!this.config) return;
    const today = new Date().toISOString().split('T')[0];
    if (this.config.lastActiveDate === today) return;

    this.config.lastActiveDate = today;
    this.writeConfig(this.config);

    this.capture('daily_active_user', {
      date: today,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }
}

function sanitizeExceptionEntry(obj: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') safe[k] = v.slice(0, MAX_STRING_LENGTH);
    else if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
  }
  return safe;
}
