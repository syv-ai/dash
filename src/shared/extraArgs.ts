import { shellSplit } from './shellQuote';

/**
 * The extra `claude` arguments a person adds to a task's session, checked
 * before they reach `claude --bg`. A denylist, not an allowlist: Claude Code
 * adds flags most weeks, and what Dash owns is small and stable, so a new
 * flag passes and an unknown or misspelled one fails at dispatch with the
 * CLI's own message. Flag facts: code.claude.com/docs/en/cli-reference and
 * `claude --help` on 2.1.332 (docs/plans/2026-11-27-claude-cli-flags.md).
 */

/** Where a blocked flag's setting lives in Dash instead. */
export type FlagRoute = 'permissions' | 'model' | 'effort' | 'agent' | 'remoteControl';

export interface FlagNote {
  /** The flag as typed (`-n`, `--model=opus`). */
  flag: string;
  /** Its long name (`--name`, `--model`), what the rules are keyed on. */
  name: string;
  /** Why, as a sentence that follows the flag. */
  reason: string;
  route?: FlagRoute;
}

export interface ExtraArgsCheck {
  /** True when the args can be passed: they parse and nothing is blocked. */
  ok: boolean;
  /** The words to pass, as typed (empty when not ok). */
  args: string[];
  blocked: FlagNote[];
  /** Allowed, with a warning (they widen or strip what Claude Code guards). */
  risky: FlagNote[];
  /** Why the line can't be read at all (a quote, an operator, a prompt). */
  error?: string;
}

/** Short and spelled-differently names, mapped to the long name the rules use. */
const ALIASES: Record<string, string> = {
  '-c': '--continue',
  '-d': '--debug',
  '-h': '--help',
  '-n': '--name',
  '-p': '--print',
  '-r': '--resume',
  '-v': '--version',
  '-w': '--worktree',
  '--background': '--bg',
  '--rc': '--remote-control',
  '--allowed-tools': '--allowedTools',
  '--disallowed-tools': '--disallowedTools',
};

interface Rule {
  reason: string;
  route?: FlagRoute;
}

function rules(names: string[], rule: Rule): [string, Rule][] {
  return names.map((n) => [n, rule]);
}

const BLOCKED = new Map<string, Rule>([
  ...rules(['--permission-mode', '--dangerously-skip-permissions'], {
    reason: "is set by the task's Permissions picker; use that instead.",
    route: 'permissions',
  }),
  ...rules(['--allow-dangerously-skip-permissions'], {
    reason:
      "would let the session switch to Yolo without Dash's check; use the Permissions picker.",
    route: 'permissions',
  }),
  ...rules(['--model'], {
    reason: "is set by the task's Model picker; use that instead.",
    route: 'model',
  }),
  ...rules(['--effort'], {
    reason: "is set by the task's Effort picker; use that instead.",
    route: 'effort',
  }),
  ...rules(['--agent'], {
    reason: "is chosen when the task is created (New task's Agent); it's fixed after that.",
    route: 'agent',
  }),
  ...rules(['--settings'], {
    reason:
      "would replace Dash's task settings file (your env vars, dashctl, its SessionStart hook).",
  }),
  ...rules(['--setting-sources'], {
    reason: "could leave out local settings, where Dash's hooks and status line live.",
  }),
  ...rules(['--bare', '--safe-mode', '--restricted'], {
    reason: 'turns off the hooks Dash follows the session through.',
  }),
  ...rules(['--bg'], { reason: 'is how Dash starts every session already.' }),
  ...rules(['--name'], { reason: 'is set by Dash: the session is named after the task.' }),
  ...rules(['--resume', '--continue', '--session-id', '--fork-session', '--from-pr'], {
    reason: 'picks the conversation, which Dash tracks and resumes for the task itself.',
  }),
  ...rules(['--worktree', '--tmux'], {
    reason: "makes Claude Code's own checkout; Dash owns the task's.",
  }),
  ...rules(['--remote-control'], {
    reason: 'is started from Remote Control in the task menu; use that instead.',
    route: 'remoteControl',
  }),
  ...rules(
    [
      '--cloud',
      '--remote',
      '--teleport',
      '--desktop',
      '--environment',
      '--ref',
      '--metadata',
      '--correlation-id',
    ],
    { reason: "starts a session somewhere else, not the task's local one." },
  ),
  ...rules(['--exec'], { reason: 'runs a shell job, not a Claude session.' }),
  ...rules(['--init-only'], { reason: 'runs the hooks and exits without a session.' }),
  ...rules(['--version', '--help'], { reason: 'prints and exits without a session.' }),
  ...rules(
    [
      '--print',
      '--output-format',
      '--input-format',
      '--json-schema',
      '--max-turns',
      '--max-budget-usd',
      '--no-session-persistence',
      '--permission-prompts',
      '--permission-prompt-tool',
      '--include-partial-messages',
      '--include-hook-events',
      '--replay-user-messages',
      '--forward-subagent-text',
      '--prompt-suggestions',
      '--init',
      '--maintenance',
      '--append-subagent-system-prompt',
      '--append-subagent-system-prompt-file',
      '--exclude-dynamic-system-prompt-sections',
    ],
    { reason: "works only with --print, which a background session can't use." },
  ),
]);

const RISKY = new Map<string, Rule>([
  ...rules(['--allowedTools', '--disallowedTools'], {
    reason: 'changes what Claude may do without asking you.',
  }),
  ...rules(['--tools'], {
    reason: 'limits the built-in tools; an empty list also stops dashctl.',
  }),
  ...rules(['--mcp-config'], { reason: 'loads MCP servers, which can run any command.' }),
  ...rules(['--plugin-url'], { reason: 'fetches plugin code from the web and runs it.' }),
  ...rules(['--system-prompt', '--system-prompt-file'], {
    reason: "replaces Claude Code's whole system prompt, its tool and safety guidance included.",
  }),
  ...rules(['--disable-slash-commands'], {
    reason: "turns off skills, Dash's own dash skill included.",
  }),
]);

const LONG_FLAG = /^--[A-Za-z][\w-]*(?:=|$)/;
const SHORT_FLAG = /^-[A-Za-z]$/;
const COMBINED_SHORT = /^-[A-Za-z]{2,}$/;

/** The long name a flag word stands for, or null when the word is a value. */
export function flagName(word: string): string | null {
  if (LONG_FLAG.test(word)) {
    const name = word.split('=', 1)[0]!;
    return ALIASES[name] ?? name;
  }
  if (SHORT_FLAG.test(word)) return ALIASES[word] ?? word;
  return null;
}

/** `blocked`/`risky` notes as lines to show ("--model is set by …"). */
export function flagNoteText(note: FlagNote): string {
  return `${note.flag} ${note.reason}`;
}

/** One line a check says: `fail` stops the line being passed, `warn` lets it through. */
export interface ExtraArgsMessage {
  text: string;
  tone: 'fail' | 'warn';
}

/** What a check says to the person, one line each: why it can't be read,
 *  else the blocked flags then the risky ones. Empty when all is fine. */
export function extraArgsMessages(check: ExtraArgsCheck): ExtraArgsMessage[] {
  if (check.error) return [{ text: check.error, tone: 'fail' }];
  return [
    ...check.blocked.map((n) => ({ text: flagNoteText(n), tone: 'fail' as const })),
    ...check.risky.map((n) => ({ text: flagNoteText(n), tone: 'warn' as const })),
  ];
}

/**
 * Check a task's extra arguments: split like a shell (no expansion), then
 * look up each flag. Blocked flags are the ones Dash sets itself or that a
 * background session can't use; risky ones pass with a warning. A first
 * word that isn't a flag, a bare `--` and combined short flags (`-pc`) are
 * refused: the first two would turn the rest into the prompt, and the CLI
 * itself refuses the last.
 */
export function validateExtraArgs(input: string | null | undefined): ExtraArgsCheck {
  const fail = (error: string): ExtraArgsCheck => ({
    ok: false,
    args: [],
    blocked: [],
    risky: [],
    error,
  });
  const split = shellSplit(input ?? '');
  if (!split.ok) return fail(split.error);
  const words = split.words;
  if (words.length === 0) return { ok: true, args: [], blocked: [], risky: [] };
  if (words.includes('--')) {
    return fail(
      "A bare -- isn't allowed: it would end the options, and the task sends the prompt.",
    );
  }
  const combined = words.find((w) => COMBINED_SHORT.test(w));
  if (combined) {
    return fail(
      `${combined} combines short flags; write each on its own (${[...combined.slice(1)]
        .map((c) => `-${c}`)
        .join(' ')}).`,
    );
  }
  if (flagName(words[0]!) === null) {
    return fail(`Start with a flag: "${words[0]}" would be sent to Claude as the prompt.`);
  }

  const blocked: FlagNote[] = [];
  const risky: FlagNote[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const name = flagName(word);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const block = BLOCKED.get(name);
    if (block) blocked.push({ flag: word.split('=', 1)[0]!, name, ...block });
    const risk = RISKY.get(name);
    if (risk) risky.push({ flag: word.split('=', 1)[0]!, name, ...risk });
  }
  const ok = blocked.length === 0;
  return { ok, args: ok ? words : [], blocked, risky };
}

/** The flag names in valid extra arguments, for telemetry: names only, never values. */
export function extraArgFlagNames(args: readonly string[]): string[] {
  const names = new Set<string>();
  for (const word of args) {
    const name = flagName(word);
    if (name && name.length <= 40) names.add(name);
  }
  return [...names].sort();
}
