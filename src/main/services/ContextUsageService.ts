import type { WebContents } from 'electron';
import type { ContextUsage } from '@shared/types';
import { writePty } from './ptyManager';

/**
 * Strip ANSI escape sequences from terminal output.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][A-B012]/g, '');
}

/**
 * Parse a number string that may contain commas or k/m suffixes.
 * e.g. "45,231" → 45231, "45.2k" → 45200, "1.5m" → 1500000
 */
function parseTokenCount(str: string): number {
  const cleaned = str.replace(/,/g, '').trim().toLowerCase();
  const suffixMatch = cleaned.match(/^([\d.]+)(k|m)?$/);
  if (!suffixMatch) return parseInt(cleaned, 10) || 0;
  const num = parseFloat(suffixMatch[1]);
  if (suffixMatch[2] === 'k') return Math.round(num * 1000);
  if (suffixMatch[2] === 'm') return Math.round(num * 1000000);
  return Math.round(num);
}

// Delay before sending /context after a Stop hook
const CONTEXT_QUERY_DELAY = 500;

// How long to wait for context response after sending /context
const CONTEXT_RESPONSE_TIMEOUT = 5000;

class ContextUsageServiceImpl {
  private contextData = new Map<string, ContextUsage>();
  private sender: WebContents | null = null;

  // Track PTYs where we sent /context and are waiting for response
  private pendingQueries = new Map<string, ReturnType<typeof setTimeout>>();

  // Buffer output for PTYs with pending queries
  private outputBuffers = new Map<string, string>();

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
   * Schedule a /context query for a PTY. Called when Stop hook fires.
   */
  queryContext(ptyId: string): void {
    // Clear any existing pending query for this PTY
    const existing = this.pendingQueries.get(ptyId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingQueries.delete(ptyId);

      // Start buffering output
      this.outputBuffers.set(ptyId, '');

      // Send /context command to the PTY
      writePty(ptyId, '/context\n');

      // Set a timeout to stop waiting for response
      const responseTimer = setTimeout(() => {
        this.finishQuery(ptyId);
      }, CONTEXT_RESPONSE_TIMEOUT);

      this.pendingQueries.set(ptyId, responseTimer);
    }, CONTEXT_QUERY_DELAY);

    this.pendingQueries.set(ptyId, timer);
  }

  /**
   * Process PTY output. Called for every data chunk from a PTY.
   * Passively parses for context usage patterns.
   */
  handleOutput(ptyId: string, data: string): void {
    // Always try passive parsing on all output
    const parsed = this.tryParse(data);
    if (parsed) {
      this.updateContext(ptyId, parsed);
    }

    // If we have a pending query, buffer the output
    if (this.outputBuffers.has(ptyId)) {
      const buffer = this.outputBuffers.get(ptyId)! + data;
      this.outputBuffers.set(ptyId, buffer);

      // Try to parse the buffered output
      const bufferedParsed = this.tryParse(buffer);
      if (bufferedParsed) {
        this.updateContext(ptyId, bufferedParsed);
        this.finishQuery(ptyId);
      }
    }
  }

  /**
   * Try to parse context usage from text.
   */
  private tryParse(rawData: string): ContextUsage | null {
    const text = stripAnsi(rawData);

    // Pattern 1: "X / Y tokens (Z%)" or "X/Y tokens (Z%)"
    const fracMatch = text.match(
      /([\d,]+(?:\.\d+)?[km]?)\s*\/\s*([\d,]+(?:\.\d+)?[km]?)\s*tokens?\s*\((\d+(?:\.\d+)?)%\)/i,
    );
    if (fracMatch) {
      return {
        used: parseTokenCount(fracMatch[1]),
        total: parseTokenCount(fracMatch[2]),
        percentage: parseFloat(fracMatch[3]),
        updatedAt: new Date().toISOString(),
      };
    }

    // Pattern 2: "Z% of context" or "context: Z%" with token counts nearby
    const pctMatch = text.match(/(\d+(?:\.\d+)?)%\s*(?:of\s+)?context/i);
    if (pctMatch) {
      const percentage = parseFloat(pctMatch[1]);
      // Look for token counts in the surrounding text
      const tokenMatches = text.match(/([\d,]+(?:\.\d+)?[km]?)\s*tokens?/gi);
      if (tokenMatches && tokenMatches.length >= 1) {
        const counts = tokenMatches.map((m) => {
          const numMatch = m.match(/([\d,]+(?:\.\d+)?[km]?)/);
          return numMatch ? parseTokenCount(numMatch[1]) : 0;
        });
        const total = Math.max(...counts);
        return {
          used: Math.round((percentage / 100) * total),
          total,
          percentage,
          updatedAt: new Date().toISOString(),
        };
      }
      // No token counts found, but we have percentage
      return {
        used: 0,
        total: 0,
        percentage,
        updatedAt: new Date().toISOString(),
      };
    }

    // Pattern 3: "Total: X tokens" or "context window: X tokens" (without fraction)
    // Less useful but captures some info
    const totalMatch = text.match(
      /(?:total|context\s*window)\s*:?\s*([\d,]+(?:\.\d+)?[km]?)\s*tokens?/i,
    );
    if (totalMatch) {
      const used = parseTokenCount(totalMatch[1]);
      // Without knowing the total, estimate percentage based on 200k default
      const estimatedTotal = 200000;
      return {
        used,
        total: estimatedTotal,
        percentage: Math.round((used / estimatedTotal) * 100 * 10) / 10,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
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
   * Finish a pending context query (either parsed successfully or timed out).
   */
  private finishQuery(ptyId: string): void {
    const timer = this.pendingQueries.get(ptyId);
    if (timer) clearTimeout(timer);
    this.pendingQueries.delete(ptyId);
    this.outputBuffers.delete(ptyId);
  }

  /**
   * Get context usage for a specific PTY.
   */
  get(ptyId: string): ContextUsage | null {
    return this.contextData.get(ptyId) ?? null;
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
    this.finishQuery(ptyId);
    this.emitAll();
  }

  private emitAll(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:contextUsage', this.getAll());
    }
  }
}

export const contextUsageService = new ContextUsageServiceImpl();
