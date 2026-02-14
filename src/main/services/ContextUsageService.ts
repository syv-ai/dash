import type { WebContents } from 'electron';
import type { ContextUsage } from '@shared/types';

/**
 * Tracks context window usage for each PTY.
 * Receives structured JSON data from Claude Code's statusLine feature
 * via the HookServer's /hook/context endpoint.
 */
class ContextUsageServiceImpl {
  private contextData = new Map<string, ContextUsage>();
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
  updateFromStatusLine(
    ptyId: string,
    data: {
      context_window?: {
        used_percentage?: number;
        context_window_size?: number;
        current_usage?: number;
      };
    },
  ): void {
    const cw = data.context_window;
    if (!cw) return;

    const percentage = cw.used_percentage ?? 0;
    const total = cw.context_window_size ?? 0;
    const used = cw.current_usage ?? Math.round((percentage / 100) * total);

    const usage: ContextUsage = {
      used,
      total,
      percentage,
      updatedAt: new Date().toISOString(),
    };

    this.updateContext(ptyId, usage);
  }

  /**
   * Update stored context data and check for compaction.
   */
  private updateContext(ptyId: string, usage: ContextUsage): void {
    // Clear reuse grace if expired
    const unregAt = this.recentlyUnregistered.get(ptyId);
    if (unregAt && Date.now() - unregAt > ContextUsageServiceImpl.REUSE_GRACE_MS) {
      this.recentlyUnregistered.delete(ptyId);
    }

    const prevUsed = this.previousUsed.get(ptyId);

    // Detect compaction: significant drop in used tokens (>30% decrease).
    // Skip if this PTY was recently unregistered (new session, not compaction).
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

  /**
   * Get all context usage data.
   */
  getAll(): Record<string, ContextUsage> {
    const result: Record<string, ContextUsage> = {};
    for (const [id, usage] of this.contextData) {
      result[id] = usage;
    }
    return result;
  }

  /**
   * Clean up when a PTY is removed.
   */
  unregister(ptyId: string): void {
    this.contextData.delete(ptyId);
    this.previousUsed.delete(ptyId);
    this.recentlyUnregistered.set(ptyId, Date.now());
    this.emitAll();
  }

  private emitAll(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:contextUsage', this.getAll());
    }
  }
}

export const contextUsageService = new ContextUsageServiceImpl();
