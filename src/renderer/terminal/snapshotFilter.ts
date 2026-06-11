/**
 * Decide whether a persisted shell snapshot is worth replaying on a fresh
 * spawn. An untouched terminal's snapshot is just the idle clack prompt
 * (`◇  dir` / `│  `); replaying it under the new shell's own first prompt
 * renders a confusing duplicate. Only replay snapshots with real content.
 */

/* eslint-disable no-control-regex -- these regexes intentionally match the
   ESC / BEL bytes of terminal control sequences. */

const CSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\][^]*(?:|\\)/g;
const MISC_ESC_RE = /[()][A-Za-z0-9]|[=>]/g;

/** True when the snapshot holds nothing but idle clack prompt block(s). */
export function isPromptOnlySnapshot(data: string): boolean {
  const text = data.replace(OSC_RE, '').replace(CSI_RE, '').replace(MISC_ESC_RE, '');
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, '').trimEnd())
    .every((line) => line === '' || /^[◇■]\s/.test(line) || /^│$/.test(line));
}
