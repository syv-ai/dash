import { z } from 'zod';
import { parseClaudeVersion } from '../services/claudeCli';
import { checkShape } from './check';
import { driftValue, type DriftFinding } from './types';

/**
 * Claude Code's internal files Dash reads: a job's `state.json`, the session
 * registry (`sessions/<pid>.json`) and transcript lines. None is a documented
 * interface and each release adds keys, so these checks are loose: only the
 * fields Dash reads are checked, and new fields don't report (C4).
 */

const opt = <T extends z.ZodType>(t: T) => t.optional();

/**
 * A job's `state.json` `cliVersion` (U2's fallback). Absent before the
 * session's first turn, which is known and doesn't report; present but not a
 * version does.
 */
export function checkJobState(raw: unknown): DriftFinding[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ kind: 'wrong-type', path: '$' }];
  }
  const v = (raw as { cliVersion?: unknown }).cliVersion;
  if (v === undefined) return [];
  if (typeof v !== 'string') return [{ kind: 'wrong-type', path: 'cliVersion' }];
  return parseClaudeVersion(v) ? [] : [{ kind: 'unparseable-output', path: 'cliVersion' }];
}

/** The registry fields Dash reads (claudeSessionRegistry.parseSessionEntry). */
const sessionEntrySchema = z.looseObject({
  pid: z.number().int().positive(),
  sessionId: opt(z.string()),
  jobId: opt(z.string()),
  name: opt(z.string()),
  messagingSocketPath: opt(z.string()),
  status: opt(z.string()),
  updatedAt: opt(z.number()),
  version: opt(z.string()),
});

export function checkSessionEntry(raw: unknown): DriftFinding[] {
  return checkShape(sessionEntrySchema, raw);
}

/**
 * Transcript entry types with a `uuid` that Claude Code writes, as seen live
 * (2.1.332). The format is internal ("changes between versions",
 * code.claude.com/docs/en/sessions), so these come from transcripts, not docs.
 * `attachment` is context Claude Code attached to a turn (hook output,
 * reminders, edited-file snippets, tool listings); Dash totals none of it.
 */
export const TRANSCRIPT_ENTRY_TYPES = [
  'user',
  'assistant',
  'system',
  'summary',
  'file-history-snapshot',
  'queue-operation',
  'attachment',
] as const;

/** A transcript entry `type` Dash doesn't know: Claude Code wrote something new. */
export function checkTranscriptEntryType(type: unknown): DriftFinding[] {
  if ((TRANSCRIPT_ENTRY_TYPES as readonly unknown[]).includes(type)) return [];
  if (typeof type !== 'string') return [{ kind: 'wrong-type', path: 'type' }];
  const value = driftValue(type);
  return [{ kind: 'unknown-enum-value', path: 'type', ...(value ? { value } : {}) }];
}

/** An assistant line's `message.usage`, which token and cost totals add up. */
const usageSchema = z.looseObject({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: opt(z.number()),
  cache_read_input_tokens: opt(z.number()),
});

/** The model families claudePricing prices; any other model id is priced as Sonnet. */
const PRICED_MODEL = /opus|sonnet|haiku/i;

/**
 * Drift in one transcript message Dash totals: usage of the wrong shape, or a
 * model claudePricing has no family for (it falls back to Sonnet's price).
 * `<synthetic>` is Claude Code's own placeholder for local messages.
 */
export function checkTranscriptUsage(usage: unknown, model: unknown): DriftFinding[] {
  const findings =
    usage === undefined ? [] : prefix('message.usage', checkShape(usageSchema, usage));
  if (typeof model === 'string' && model !== '<synthetic>' && !PRICED_MODEL.test(model)) {
    const value = driftValue(model);
    findings.push({
      kind: 'unknown-enum-value',
      path: 'message.model',
      ...(value ? { value } : {}),
    });
  }
  return findings;
}

/**
 * `plugins/installed_plugins.json`, the fields the slash-command list reads:
 * each plugin key's installs, with where it lives and for which project.
 */
const installedPluginsSchema = z.looseObject({
  plugins: z.record(
    z.string(),
    z.array(
      z.looseObject({
        scope: z.string(),
        installPath: z.string(),
        projectPath: opt(z.string()),
      }),
    ),
  ),
});

export function checkInstalledPlugins(raw: unknown): DriftFinding[] {
  return checkShape(installedPluginsSchema, raw);
}

function prefix(base: string, findings: DriftFinding[]): DriftFinding[] {
  return findings.map((f) => ({ ...f, path: f.path === '$' ? base : `${base}.${f.path}` }));
}
