import { z } from 'zod';
import { parseClaudeVersion } from '../services/claudeCli';
import {
  SUPERVISOR_STATES,
  SUPERVISOR_STATUSES,
  isDispatchFailure,
  parseDispatchOutput,
  parseUntrustedAddDir,
  parseUntrustedRoot,
} from '../services/supervisorSession';
import { checkShape } from './check';
import { driftValue, type DriftFinding } from './types';

/**
 * Claude Code's command-line output Dash reads: `claude agents --json` (a
 * documented script interface: strict, new fields report), `claude
 * --version`, `claude --bg`'s dispatch line, and exit codes.
 */

const opt = <T extends z.ZodType>(t: T) => t.optional();

/** One `claude agents --json --all` row, as 2.1.332 prints it (live listing, 44 rows). */
export const agentsRowSchema = z.strictObject({
  id: opt(z.string()),
  sessionId: opt(z.string()),
  name: opt(z.string()),
  cwd: z.string(),
  kind: z.enum(['background', 'interactive']),
  startedAt: z.number(),
  state: opt(z.enum(SUPERVISOR_STATES)),
  // Present only on a row with a live process (2.1.332).
  status: opt(z.enum(SUPERVISOR_STATUSES)),
  waitingFor: opt(z.string()),
  pid: opt(z.number()),
  detail: opt(z.string()),
});

/** Drift in a whole listing: rows are checked alike, so paths read `[].field`. */
export function checkAgentsJson(stdout: string): DriftFinding[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [{ kind: 'unparseable-output', path: 'stdout' }];
  }
  return checkShape(z.array(agentsRowSchema), raw);
}

/**
 * `claude --bg`'s output should be one Dash knows the words for: the
 * `backgrounded · <id>` line, or a refusal it acts on: couldn't start, the
 * workspace isn't trusted, or an `--add-dir` folder isn't ("Added folder not
 * trusted: <path>. Leave out its --add-dir …", 2.1.332, live). Anything else
 * is drift: Dash shows the CLI's words as they are.
 */
export function checkDispatchOutput(output: string): DriftFinding[] {
  const known =
    parseDispatchOutput(output) !== null ||
    isDispatchFailure(output) ||
    parseUntrustedRoot(output) !== null ||
    parseUntrustedAddDir(output) !== null;
  return known ? [] : [{ kind: 'unparseable-output', path: 'stdout' }];
}

/** `claude --version` should start with `M.m.p`. */
export function checkVersionOutput(stdout: string): DriftFinding[] {
  return parseClaudeVersion(stdout.trim()) ? [] : [{ kind: 'unparseable-output', path: 'stdout' }];
}

/**
 * A CLI call that exited non-zero where Dash expected success, as a finding;
 * none for a failure that isn't an exit status (a timeout, a missing binary).
 */
export function exitCodeDrift(err: unknown): DriftFinding[] {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'number') return [];
  const value = driftValue(code);
  return [{ kind: 'unexpected-exit-code', path: 'exit', ...(value ? { value } : {}) }];
}
