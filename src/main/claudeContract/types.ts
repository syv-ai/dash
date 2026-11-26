/**
 * Contract drift: Claude Code behaving differently from what Dash expects at
 * one of the boundaries where Dash takes its data (hooks, the statusLine,
 * `claude agents --json`, …). A drift report names where and how, never what:
 * no values or content (prompts, paths, tool input, error text). The one
 * exception is `value`, the unknown member of a Claude Code enum or an exit
 * code, kept only when it is identifier-shaped (`driftValue`).
 */

export const DRIFT_KINDS = [
  'unknown-event',
  'missing-field',
  'unexpected-field',
  'unknown-enum-value',
  'wrong-type',
  'unparseable-output',
  'unexpected-exit-code',
] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

/**
 * Where the data came from. Hook payloads are `hook:<Event>` (the event the
 * payload names, or the one its endpoint expects when it names none).
 */
export type DriftSource =
  | `hook:${string}`
  | 'hook'
  | 'statusline'
  | 'agents-json'
  | 'dispatch'
  | 'cli-version'
  | 'job-state'
  | 'session-registry'
  | 'transcript'
  | 'remote-control';

/** One mismatch inside a payload: what kind, at which field. */
export interface DriftFinding {
  kind: DriftKind;
  /** Dotted field path; arrays as `[]` with no index (`background_tasks[].type`). */
  path: string;
  /** The unknown enum member or exit code, identifier-shaped only. */
  value?: string;
}

/** A finding with the source and Claude Code version it was seen under. */
export interface DriftReport extends DriftFinding {
  source: DriftSource;
  /** `M.m.p`, or `unknown` when Dash can't tell. */
  claudeVersion: string;
}

/** No slashes, so no paths; short, so no sentences. */
const IDENTIFIER = /^[A-Za-z0-9][\w .:-]{0,47}$/;

/**
 * A value safe to keep in a drift record: a short identifier (an enum member
 * like `elicitation_dialog`, a model id, an exit code). Anything else, which
 * could be content, is dropped.
 */
export function driftValue(value: unknown): string | undefined {
  const s = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof s === 'string' && IDENTIFIER.test(s) ? s : undefined;
}
