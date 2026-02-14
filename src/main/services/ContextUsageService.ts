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
    const prevUsed = this.previousUsed.get(ptyId);

    // Detect compaction: significant drop in used tokens (>30% decrease)
    if (prevUsed !== undefined && usage.used < prevUsed * 0.7 && prevUsed > 1000) {
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
    this.emitAll();
  }

  private emitAll(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:contextUsage', this.getAll());
    }
  }
}

export const contextUsageService = new ContextUsageServiceImpl();
