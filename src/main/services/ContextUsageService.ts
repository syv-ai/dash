import { eq } from 'drizzle-orm';
import type { WebContents } from 'electron';
import type { ContextUsage, StatusLineData, SessionCost, RateLimits } from '@shared/types';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';

const EMIT_DEBOUNCE_MS = 500;

/** Raw JSON shape from Claude Code's statusLine (snake_case, all fields optional). */
export interface RawStatusLinePayload {
  context_window?: {
    context_window_size?: number;
    current_usage?: number | Record<string, number>;
    used_percentage?: number;
  };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
  model?: string | { display_name?: string; id?: string };
}

/**
 * Tracks context window usage and session stats for each PTY.
 * Receives structured JSON data from Claude Code's statusLine feature
 * via the HookServer's /hook/context endpoint.
 */

class ContextUsageServiceImpl {
  private statusLineData = new Map<string, StatusLineData>();
  private sender: WebContents | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Underlying task ids we've already warned about a stale `shell:*` hook for. */
  private warnedStaleHookTaskIds = new Set<string>();

  setSender(sender: WebContents): void {
    this.sender = sender;
  }

  /**
   * Update context usage from Claude Code's statusLine JSON data.
   * Called by HookServer when the status line script POSTs data.
   */
  updateFromStatusLine(ptyId: string, data: RawStatusLinePayload): void {
    // Shell-tab PTYs use ids like `shell:<taskId>[:t<ts>]` and never represent
    // a real Claude task. A stale `.claude/settings.local.json` (older Dash
    // versions clobbered it with a shell ptyId via refreshActivePtyHooks)
    // can keep posting statusLine under that id; ignore so we don't grow a
    // ghost entry the renderer has no task row for, and warn the user once
    // per task so they know a restart is needed to heal the file.
    if (ptyId.startsWith('shell:')) {
      this.warnStaleShellHook(ptyId);
      return;
    }
    const cw = data.context_window;
    if (!cw) {
      console.warn('[ContextUsageService] No context_window in statusLine data for ptyId=', ptyId);
      return;
    }

    const total = typeof cw.context_window_size === 'number' ? cw.context_window_size : 0;
    if (total === 0) {
      console.warn('[ContextUsageService] context_window_size is 0 or missing for ptyId=', ptyId);
    }

    // current_usage is an object: { input_tokens, output_tokens, cache_creation_input_tokens, ... }
    let used: number;
    if (typeof cw.current_usage === 'number') {
      used = cw.current_usage;
    } else if (cw.current_usage && typeof cw.current_usage === 'object') {
      used = Object.values(cw.current_usage as Record<string, unknown>).reduce<number>(
        (sum, v) => sum + (typeof v === 'number' ? v : 0),
        0,
      );
    } else {
      console.warn(
        '[ContextUsageService] current_usage missing or unexpected type for ptyId=',
        ptyId,
        '— falling back to used_percentage',
      );
      const pct = typeof cw.used_percentage === 'number' ? cw.used_percentage : 0;
      used = Math.round((pct / 100) * total);
    }

    // Compute percentage from used/total to keep fields consistent
    const percentage = Math.max(0, Math.min(100, total > 0 ? (used / total) * 100 : 0));

    const now = Date.now();

    const usage: ContextUsage = { used, total, percentage };

    // Parse cost
    let cost: SessionCost | undefined;
    if (data.cost && typeof data.cost === 'object') {
      const c = data.cost;
      cost = {
        totalCostUsd: typeof c.total_cost_usd === 'number' ? c.total_cost_usd : 0,
        totalDurationMs: typeof c.total_duration_ms === 'number' ? c.total_duration_ms : 0,
        totalApiDurationMs:
          typeof c.total_api_duration_ms === 'number' ? c.total_api_duration_ms : 0,
        totalLinesAdded: typeof c.total_lines_added === 'number' ? c.total_lines_added : 0,
        totalLinesRemoved: typeof c.total_lines_removed === 'number' ? c.total_lines_removed : 0,
      };
    }

    // Parse rate limits
    let rateLimits: RateLimits | undefined;
    if (data.rate_limits && typeof data.rate_limits === 'object') {
      rateLimits = {};
      const fh = data.rate_limits.five_hour;
      if (fh) {
        rateLimits.fiveHour = {
          usedPercentage: typeof fh.used_percentage === 'number' ? fh.used_percentage : 0,
          resetsAt: typeof fh.resets_at === 'number' ? fh.resets_at : 0,
        };
      }
      const sd = data.rate_limits.seven_day;
      if (sd) {
        rateLimits.sevenDay = {
          usedPercentage: typeof sd.used_percentage === 'number' ? sd.used_percentage : 0,
          resetsAt: typeof sd.resets_at === 'number' ? sd.resets_at : 0,
        };
      }
    }

    const modelRaw = data.model;
    const model =
      typeof modelRaw === 'string' ? modelRaw : (modelRaw?.display_name ?? modelRaw?.id);

    const statusLine: StatusLineData = {
      contextUsage: usage,
      cost,
      rateLimits,
      model: typeof model === 'string' ? model : undefined,
      updatedAt: now,
    };

    this.statusLineData.set(ptyId, statusLine);
    this.scheduleEmit();
  }

  getAllStatusLine(): Record<string, StatusLineData> {
    return Object.fromEntries(this.statusLineData);
  }

  unregister(ptyId: string): void {
    this.statusLineData.delete(ptyId);
    this.scheduleEmit();
  }

  stop(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.statusLineData.clear();
    this.warnedStaleHookTaskIds.clear();
    this.sender = null;
  }

  private warnStaleShellHook(shellPtyId: string): void {
    // Shell ptyId format is `shell:<taskId>` or `shell:<taskId>:t<ts>`.
    const taskId = shellPtyId.split(':')[1];
    if (!taskId || this.warnedStaleHookTaskIds.has(taskId)) return;
    this.warnedStaleHookTaskIds.add(taskId);

    if (!this.sender || this.sender.isDestroyed()) return;

    let taskName = 'A task';
    try {
      const row = getDb().select({ name: tasks.name }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (row?.name) taskName = row.name;
    } catch (err) {
      console.warn('[ContextUsageService] DB lookup for stale-hook task failed:', err);
    }

    this.sender.send('app:toast', {
      message: `${taskName}: context tracking is stale (settings point to a closed shell). Restart Dash or this task to heal.`,
    });
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      if (this.sender && !this.sender.isDestroyed()) {
        this.sender.send('pty:statusLine', this.getAllStatusLine());
      }
    }, EMIT_DEBOUNCE_MS);
  }
}

export const contextUsageService = new ContextUsageServiceImpl();
