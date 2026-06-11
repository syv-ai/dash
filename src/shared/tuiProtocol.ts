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
