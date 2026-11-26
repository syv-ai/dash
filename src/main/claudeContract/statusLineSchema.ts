import { z } from 'zod';
import { EFFORT_LEVELS } from './hookSchemas';

/**
 * The statusLine's JSON (code.claude.com/docs/en/statusline, "Full JSON
 * schema", fetched 2026-11-26 for 2.1.332). Dash owns a task's statusLine
 * (ptyHookSettings) and reads the context window, cost, rate limits and model
 * from it. Every documented field is modelled, required unless the docs list it
 * as possibly absent ("Fields that may be absent"); `prompt_cache` is a stats bag
 * Dash doesn't read, so it isn't walked.
 */

const str = z.string();
const num = z.number();
const opt = <T extends z.ZodType>(t: T) => t.optional();

const window = z.strictObject({ used_percentage: num, resets_at: num });

export const statusLineSchema = z.strictObject({
  hook_event_name: opt(str),
  cwd: str,
  session_id: str,
  session_name: opt(str),
  prompt_id: opt(str),
  transcript_path: str,
  version: str,
  model: z.strictObject({ id: str, display_name: str }),
  workspace: z.strictObject({
    current_dir: str,
    project_dir: str,
    added_dirs: z.array(str),
    git_worktree: opt(str),
    repo: opt(z.strictObject({ host: str, owner: str, name: str })),
  }),
  output_style: z.strictObject({ name: str }),
  cost: z.strictObject({
    total_cost_usd: num,
    total_duration_ms: num,
    total_api_duration_ms: num,
    total_lines_added: num,
    total_lines_removed: num,
  }),
  context_window: z.strictObject({
    total_input_tokens: num,
    total_output_tokens: num,
    context_window_size: num,
    // Null before the session's first API response.
    used_percentage: num.nullable(),
    remaining_percentage: num.nullable(),
    current_usage: z
      .strictObject({
        input_tokens: num,
        output_tokens: num,
        cache_creation_input_tokens: num,
        cache_read_input_tokens: num,
      })
      .nullable(),
  }),
  exceeds_200k_tokens: z.boolean(),
  prompt_cache: opt(z.record(str, z.unknown())),
  fast_mode: z.boolean(),
  effort: opt(z.strictObject({ level: z.enum(EFFORT_LEVELS) })),
  thinking: z.strictObject({ enabled: z.boolean() }),
  rate_limits: opt(
    z.strictObject({
      five_hour: opt(window),
      seven_day: opt(window),
      spend_limit: opt(
        z.strictObject({
          used_percentage: num,
          resets_at: num,
          used_usd: opt(num),
          limit_usd: opt(num),
          period: opt(str),
        }),
      ),
    }),
  ),
  vim: opt(z.strictObject({ mode: z.enum(['NORMAL', 'INSERT', 'VISUAL', 'VISUAL LINE']) })),
  agent: opt(z.strictObject({ name: str })),
  pr: opt(
    z.strictObject({
      number: num,
      url: str,
      review_state: opt(z.enum(['approved', 'pending', 'changes_requested', 'draft'])),
      kind: opt(z.enum(['mr'])),
    }),
  ),
  worktree: opt(
    z.strictObject({
      name: str,
      path: str,
      branch: opt(str),
      original_cwd: str,
      original_branch: opt(str),
    }),
  ),
});
