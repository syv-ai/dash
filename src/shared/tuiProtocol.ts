/**
 * Generic wire protocol for side-car TUI processes. A feature defines its own
 * `Show` (screens) and `Choice` (user picks) unions; the envelope contributes
 * the lifecycle messages shared by every feature.
 */

/** Messages from main to the side-car. */
export type MainToTui<Show> = Show | { type: 'progress'; text: string } | { type: 'shutdown' };

/** Messages from the side-car to main. */
export type TuiToMain<Choice> =
  | { type: 'ready'; version: number }
  | Choice
  | { type: 'exit'; reason: 'user' | 'shutdown-ack' | 'error' }
  | { type: 'error'; message: string };

/** Envelope version, shared by all features. */
export const TUI_PROTOCOL_VERSION = 1;

/**
 * Features the renderer auto-offers on task switch (via tui:requestStart).
 * Registering a feature in main without listing it here means it can only be
 * started programmatically (e.g. the ports setup flow spawned by migrate).
 */
export const TUI_FEATURE_IDS = ['ports'] as const;
export type TuiFeatureId = (typeof TUI_FEATURE_IDS)[number];

/**
 * Fixed side-car terminal dimensions. Clack's resize handler re-renders with
 * a fragile diff that garbles when dims change, so the canvas is truly pinned:
 * the PTY spawns at these dims and the renderer locks its xterm to them — a
 * TUI session is never fit-resized. The width must therefore be narrow enough
 * to fit the right panel at its widened size (TUI_PANEL_PCT) down to the app's
 * 1200px minimum window; 52 cols clears that with margin and the canvas is
 * left-aligned so the gutter survives even on a narrower panel. 15 rows clears
 * the onboarding CTA's header + wrapped copy + three options.
 */
export const TUI_COLS = 52;
export const TUI_ROWS = 15;
