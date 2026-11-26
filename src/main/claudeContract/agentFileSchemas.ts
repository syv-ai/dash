import * as path from 'path';
import { z } from 'zod';
import type { Frontmatter } from '../services/memoryFiles';
import { checkShape } from './check';
import type { DriftFinding } from './types';

/**
 * What the task sidebar's Agent tab reads of Claude Code's own files: a
 * session's scratchpad folder and its auto-memory files. Neither is an API,
 * so both checks are loose (C4): only what Dash relies on is checked.
 */

/**
 * The scratchpad layout Dash derives a dir from when no payload has named one
 * yet (`services/scratchpad.ts`): `…/<session-id>/scratchpad`
 * (code.claude.com/docs/en/claude-directory, "Session scratchpad directory").
 * A payload's dir that isn't shaped so reports, under the payload's own
 * session id; the temp root and `<project>` aren't checked, since a user's
 * `CLAUDE_CODE_TMPDIR` moves the first and `/cd` changes the second.
 */
export function checkScratchpadDir(payload: Record<string, unknown>): DriftFinding[] {
  const dir = payload.scratchpad_dir;
  if (dir === undefined) return [];
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    return [{ kind: 'wrong-type', path: 'scratchpad_dir' }];
  }
  const resolved = path.resolve(dir);
  const sessionId = payload.session_id;
  const shaped =
    path.basename(resolved) === 'scratchpad' &&
    (typeof sessionId !== 'string' || path.basename(path.dirname(resolved)) === sessionId);
  return shaped ? [] : [{ kind: 'unparseable-output', path: 'scratchpad_dir' }];
}

/** The documented memory types (code.claude.com/docs/en/memory, "Auto memory"). */
const MEMORY_TYPE = z.enum(['user', 'feedback', 'project', 'reference']);

/**
 * A memory file's frontmatter: `name`, `description` and `type`, plus the
 * `modified` timestamp Claude Code stamps on each write (docs, fetched
 * 2026-11-26). 2.1.332 nests `type` and `modified` under `metadata:` beside
 * `node_type` and `originSessionId` (live, 2026-11-26); older files keep
 * `type` at the top. Loose: keys Claude adds don't report.
 */
const memoryFrontmatterSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string(),
  type: MEMORY_TYPE.optional(),
  metadata: z.looseObject({ type: MEMORY_TYPE.optional() }).optional(),
  modified: z.string().optional(),
});

/**
 * Drift in one memory file's frontmatter (`readFrontmatter`'s, null when the
 * file has none): a missing block, a missing or unknown type, or a field of
 * the wrong shape.
 */
export function checkMemoryFrontmatter(frontmatter: Frontmatter | null): DriftFinding[] {
  if (!frontmatter) return [{ kind: 'missing-field', path: 'frontmatter' }];
  const findings = checkShape(memoryFrontmatterSchema, frontmatter);
  const nested = frontmatter.metadata;
  const typed =
    frontmatter.type !== undefined || (typeof nested === 'object' && nested.type !== undefined);
  if (!typed) findings.push({ kind: 'missing-field', path: 'type' });
  return findings;
}
