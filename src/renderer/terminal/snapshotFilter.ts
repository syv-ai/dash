/**
 * Decide whether a persisted shell snapshot is worth replaying on a fresh
 * spawn. An untouched terminal's snapshot is just Dash's idle two-line shell
 * prompt — the `<folder>` line then a bare `$`. Replaying it under the new
 * shell's own first prompt renders a confusing duplicate. Only replay real
 * content (command output / scrollback).
 */

/* eslint-disable no-control-regex -- these regexes intentionally match the
   ESC / BEL bytes of terminal control sequences. */

const CSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\][^]*(?:|\\)/g;
const MISC_ESC_RE = /[()][A-Za-z0-9]|[=>]/g;

/** A bare shell prompt sigil line — the second line of Dash's two-line
 *  `<folder>\n$ ` prompt: `$` (sh/bash), `%` (zsh), `#` (root). */
const PROMPT_SIGIL_RE = /^[$%#]$/;

/**
 * True when the snapshot holds nothing but idle prompt block(s). Pass
 * `promptLabel` (the cwd basename the shell prints on the prompt's first line)
 * so the `<folder>\n$ ` prompt is recognized — without it the folder line reads
 * as real content and the prompt replays as a duplicate.
 */
export function isPromptOnlySnapshot(data: string, promptLabel?: string): boolean {
  const text = data.replace(OSC_RE, '').replace(CSI_RE, '').replace(MISC_ESC_RE, '');
  const label = promptLabel?.trim();
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, '').trim())
    .every(
      (line) =>
        line === '' || PROMPT_SIGIL_RE.test(line) || (label !== undefined && line === label),
    );
}
