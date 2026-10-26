/**
 * A shared memory budget for every live xterm in the renderer.
 *
 * Each task keeps its terminals alive (detached, still receiving output) until
 * the task is deleted, so with dozens of tasks the scrollback alone can grow to
 * gigabytes and get the renderer OOM-killed. Most of that memory is xterm's
 * typed-array line storage, which lives outside the JS heap, so heap readings
 * (`performance.memory`) can't see it. The budget instead estimates each
 * buffer from its size, and trims the least recently viewed terminals first.
 */

// xterm stores a cell as three uint32s (12 bytes) in typed arrays; the JS
// heap's line objects add a little on top, which the measurements absorbed.
const BYTES_PER_CELL = 12;

/** Renderer-wide terminal budgets offered in Settings → Terminal, in MB. */
export const TERMINAL_MEMORY_LIMITS = ['512', '1024', '1536', '2048', '4096'] as const;
export type TerminalMemoryLimit = (typeof TERMINAL_MEMORY_LIMITS)[number];
export const DEFAULT_TERMINAL_MEMORY_LIMIT: TerminalMemoryLimit = '1536';

/** '512' → '512 MB', '1536' → '1.5 GB'. */
export function formatMemoryLimit(limit: TerminalMemoryLimit): string {
  const mb = Number(limit);
  return mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`;
}

/** Scrollback lines a trimmed terminal keeps at minimum (~100–150k tokens). */
export const MIN_SCROLLBACK = 10_000;

export interface BudgetedTerminal {
  id: string;
  /** Lines in the normal buffer (scrollback + screen). */
  lines: number;
  cols: number;
  /** When the terminal was last on screen; lower trims first. */
  lastViewedAt: number;
  /** On screen now — never trimmed. */
  attached: boolean;
}

export function estimateBytes(t: { lines: number; cols: number }): number {
  return t.lines * t.cols * BYTES_PER_CELL;
}

/**
 * Which terminals to trim, and to how many lines, to bring the total under
 * `budgetBytes`. Least recently viewed first, each only as far as needed and
 * never below `floorLines`; attached terminals are left alone. Returns
 * id → new line cap (empty when within budget).
 */
export function planScrollbackTrims(
  terminals: BudgetedTerminal[],
  budgetBytes: number,
  floorLines: number,
): Map<string, number> {
  const plan = new Map<string, number>();
  let excess = terminals.reduce((sum, t) => sum + estimateBytes(t), 0) - budgetBytes;
  if (excess <= 0) return plan;

  const candidates = terminals
    .filter((t) => !t.attached && t.lines > floorLines)
    .sort((a, b) => a.lastViewedAt - b.lastViewedAt);
  for (const t of candidates) {
    if (excess <= 0) break;
    const bytesPerLine = t.cols * BYTES_PER_CELL;
    const keep = Math.max(floorLines, t.lines - Math.ceil(excess / bytesPerLine));
    plan.set(t.id, keep);
    excess -= (t.lines - keep) * bytesPerLine;
  }
  return plan;
}
