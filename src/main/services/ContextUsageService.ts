import type { WebContents } from 'electron';
import type { ContextUsage, StatusLineData, SessionCost, RateLimits } from '@shared/types';

/**
 * Tracks context window usage and session stats for each PTY.
 * Receives structured JSON data from Claude Code's statusLine feature
 * via the HookServer's /hook/context endpoint.
 */
class ContextUsageServiceImpl {
  private contextData = new Map<string, ContextUsage>();
  private statusLineData = new Map<string, StatusLineData>();
  private sender: WebContents | null = null;

  // Track previous token counts to detect compaction
  private previousUsed = new Map<string, number>();

  // Track when PTYs were unregistered to avoid false compaction on reuse
  private recentlyUnregistered = new Map<string, number>();
  private static readonly REUSE_GRACE_MS = 5_000;

  // Callback for compaction events
  private compactionCallback: ((ptyId: string, from: number, to: number) => void) | null = null;

  setSender(sender: WebContents): void {
    this.sender = sender;
  }

  onCompaction(callback: (ptyId: string, from: number, to: number) => void): void {
    this.compactionCallback = callback;
  }

  /**
   * Update context usage from Claude Code's statusLine JSON data.
   * Called by HookServer when the status line script POSTs data.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateFromStatusLine(ptyId: string, data: Record<string, any>): void {
    const cw = data.context_window;
    if (!cw) return;

    const percentage = typeof cw.used_percentage === 'number' ? cw.used_percentage : 0;
    const total = typeof cw.context_window_size === 'number' ? cw.context_window_size : 0;

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
      used = Math.round((percentage / 100) * total);
    }

    const now = new Date().toISOString();

    const usage: ContextUsage = { used, total, percentage, updatedAt: now };

    // Parse cost
    let cost: SessionCost | undefined;
    if (data.cost && typeof data.cost === 'object') {
      cost = {
        totalCostUsd: data.cost.total_cost_usd ?? 0,
        totalDurationMs: data.cost.total_duration_ms ?? 0,
        totalApiDurationMs: data.cost.total_api_duration_ms ?? 0,
        totalLinesAdded: data.cost.total_lines_added ?? 0,
        totalLinesRemoved: data.cost.total_lines_removed ?? 0,
      };
    }

    // Parse rate limits
    let rateLimits: RateLimits | undefined;
    if (data.rate_limits && typeof data.rate_limits === 'object') {
      rateLimits = {};
      if (data.rate_limits.five_hour) {
        rateLimits.fiveHour = {
          usedPercentage: data.rate_limits.five_hour.used_percentage ?? 0,
          resetsAt: data.rate_limits.five_hour.resets_at ?? 0,
        };
      }
      if (data.rate_limits.seven_day) {
        rateLimits.sevenDay = {
          usedPercentage: data.rate_limits.seven_day.used_percentage ?? 0,
          resetsAt: data.rate_limits.seven_day.resets_at ?? 0,
        };
      }
    }

    const model = data.model?.display_name ?? data.model?.id;

    const statusLine: StatusLineData = {
      contextUsage: usage,
      cost,
      rateLimits,
      model: typeof model === 'string' ? model : undefined,
      updatedAt: now,
    };

    this.statusLineData.set(ptyId, statusLine);
    this.updateContext(ptyId, usage);
    this.emitStatusLine();
  }

  private updateContext(ptyId: string, usage: ContextUsage): void {
    const unregAt = this.recentlyUnregistered.get(ptyId);
    if (unregAt && Date.now() - unregAt > ContextUsageServiceImpl.REUSE_GRACE_MS) {
      this.recentlyUnregistered.delete(ptyId);
    }

    const prevUsed = this.previousUsed.get(ptyId);

    if (
      prevUsed !== undefined &&
      usage.used < prevUsed * 0.7 &&
      prevUsed > 1000 &&
      !this.recentlyUnregistered.has(ptyId)
    ) {
      this.compactionCallback?.(ptyId, prevUsed, usage.used);
    }

    this.previousUsed.set(ptyId, usage.used);
    this.contextData.set(ptyId, usage);
    this.emitAll();
  }

  getAll(): Record<string, ContextUsage> {
    const result: Record<string, ContextUsage> = {};
    for (const [id, usage] of this.contextData) {
      result[id] = usage;
    }
    return result;
  }

  getAllStatusLine(): Record<string, StatusLineData> {
    const result: Record<string, StatusLineData> = {};
    for (const [id, sl] of this.statusLineData) {
      result[id] = sl;
    }
    return result;
  }

  unregister(ptyId: string): void {
    this.contextData.delete(ptyId);
    this.statusLineData.delete(ptyId);
    this.previousUsed.delete(ptyId);
    this.recentlyUnregistered.set(ptyId, Date.now());
    this.emitAll();
    this.emitStatusLine();
  }

  private emitAll(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:contextUsage', this.getAll());
    }
  }

  private emitStatusLine(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:statusLine', this.getAllStatusLine());
    }
  }
}

export const contextUsageService = new ContextUsageServiceImpl();
