/**
 * A task's own environment variables (Task settings → Environment, dashctl
 * `--env KEY=VALUE`): which keys it may set, and why not. Pure, so every way
 * in checks with the same rules: the task dialogs (IPC), TaskService and the
 * control API.
 *
 * Two levels. Every caller is refused the keys Dash or Claude Code's sign-in
 * depend on. A task setting another task's env (dashctl from inside a task)
 * is also refused the keys that make a program load or run code it names:
 * those would run code outside the child session's permission checks, so
 * one agent could loosen another's, as with the risky extra arguments.
 */

/** Who sets the env: a person (Task settings, an orchestrator outside Dash's
 *  tasks), or an agent in a task, for a task it created. */
export type EnvSetter = 'person' | 'task';

/**
 * Keys a session's env never takes from a person or a task: the terminal and
 * identity Dash spawns with, and CLAUDE_CONFIG_DIR (Dash reads Claude Code's
 * state from its own; a task's value would split writes from reads).
 */
export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLORFGBG',
  'CLAUDE_CONFIG_DIR',
]);

/** A key as Dash takes it: upper case, digits and `_`, starting with a letter. */
export const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

/** Sign-in and secrets: a token in a task's settings would outlive the person's own sign-in. */
const AUTH_KEY = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|AUTH|CREDENTIALS?)(_|$)/;

interface KeyRule {
  test: (key: string) => boolean;
  reason: string;
}

const exact =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);
const prefix =
  (...prefixes: string[]) =>
  (key: string) =>
    prefixes.some((p) => key.startsWith(p));

/** Refused for every setter. */
const GLOBAL_RULES: KeyRule[] = [
  {
    test: (k) => RESERVED_ENV_KEYS.has(k),
    reason: 'is set by Dash for every session.',
  },
  { test: prefix('DASH_'), reason: "is Dash's own (dashctl's caller and token)." },
  {
    test: prefix('ANTHROPIC_'),
    reason: "configures Claude Code's API access and sign-in; set it in Settings → Claude.",
  },
  {
    test: prefix('CLAUDE_CODE_'),
    reason: "overrides Claude Code itself; set it in Settings → Claude's environment variables.",
  },
  {
    test: exact('CLAUDE_ENV_FILE'),
    reason: 'is a script Claude Code runs before every Bash command.',
  },
  {
    test: (k) => AUTH_KEY.test(k),
    reason: "looks like a credential; keep secrets out of a task's settings.",
  },
];

/**
 * Refused when a task sets another task's env: each makes a program load or
 * run code it names (a loader, a shell's startup file, a helper git or a tool
 * runs, where programs are found), so it would run outside the child's
 * permission checks.
 */
const TASK_RULES: KeyRule[] = [
  {
    test: (k) =>
      exact(
        'NODE_OPTIONS',
        'NODE_PATH',
        'PYTHONPATH',
        'PYTHONSTARTUP',
        'PYTHONHOME',
        'PERL5LIB',
        'PERL5OPT',
        'PERLLIB',
        'PERL5DB',
        'RUBYOPT',
        'RUBYLIB',
        'GEM_HOME',
        'GEM_PATH',
        'CLASSPATH',
        'JAVA_TOOL_OPTIONS',
        'JDK_JAVA_OPTIONS',
        '_JAVA_OPTIONS',
        'PYTHONWARNINGS',
        'PYTHONUSERBASE',
        'NODE_REPL_EXTERNAL_MODULE',
      )(k) || prefix('LD_', 'DYLD_', 'NPM_CONFIG_')(k),
    reason: 'makes a program load code it names.',
  },
  {
    test: exact('BASH_ENV', 'ENV', 'ZDOTDIR', 'SHELL', 'PROMPT_COMMAND', 'PS4', 'IFS'),
    reason: 'changes what a shell runs.',
  },
  {
    test: (k) =>
      exact(
        'GIT_SSH',
        'GIT_SSH_COMMAND',
        'GIT_EXEC_PATH',
        'GIT_CONFIG',
        'GIT_DIR',
        'GIT_ASKPASS',
        'GIT_EDITOR',
        'GIT_PAGER',
        'GIT_PROXY_COMMAND',
        'GIT_EXTERNAL_DIFF',
        'GIT_TEMPLATE_DIR',
        'GIT_SEQUENCE_EDITOR',
      )(k) || prefix('GIT_CONFIG_')(k),
    reason: 'makes git run a program or read a config it names.',
  },
  {
    test: exact(
      'EDITOR',
      'VISUAL',
      'PAGER',
      'MANPAGER',
      'LESSOPEN',
      'LESSCLOSE',
      'BROWSER',
      'SSH_ASKPASS',
      'SUDO_ASKPASS',
      'CC',
      'CXX',
      'RUSTC',
      'RUSTC_WRAPPER',
      'RUSTC_WORKSPACE_WRAPPER',
      'CARGO_BUILD_RUSTC_WRAPPER',
      'GOFLAGS',
      'GH_EDITOR',
      'GH_PAGER',
      'GH_BROWSER',
      'XDG_CONFIG_HOME',
    ),
    reason: 'names a program or config other tools run or read.',
  },
  {
    test: (k) =>
      exact(
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'NO_PROXY',
        'NODE_TLS_REJECT_UNAUTHORIZED',
        'NODE_EXTRA_CA_CERTS',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
        'REQUESTS_CA_BUNDLE',
        'CURL_CA_BUNDLE',
      )(k),
    reason: "routes or intercepts the session's network traffic, its sign-in included.",
  },
];

/**
 * Why `key` can't be set by `setter`, as a sentence naming it; null when it
 * can. The key's shape is checked first, then the rules every setter has,
 * then (for a task) the code-running ones.
 */
export function envKeyProblem(key: string, setter: EnvSetter): string | null {
  if (!ENV_KEY.test(key)) {
    return `${key || '(empty)'} isn't a variable name: use A–Z, 0–9 and _, starting with a letter.`;
  }
  const rule =
    GLOBAL_RULES.find((r) => r.test(key)) ??
    (setter === 'task' ? TASK_RULES.find((r) => r.test(key)) : undefined);
  return rule ? `${key} ${rule.reason}` : null;
}

/** Each key `setter` can't set, with its reason; [] when all can be. */
export function envProblems(
  env: Readonly<Record<string, string>>,
  setter: EnvSetter,
): { key: string; problem: string }[] {
  return Object.keys(env).flatMap((key) => {
    const problem = envKeyProblem(key, setter);
    return problem ? [{ key, problem }] : [];
  });
}

/**
 * `KEY=VALUE` words (dashctl's repeatable `--env`) as an env. The value may
 * be empty and may hold `=`; a key given twice is refused. A single empty
 * word means none (`--env ''`, to clear a task's env).
 */
export function parseEnvAssignments(
  words: readonly string[],
): { ok: true; env: Record<string, string> } | { ok: false; error: string } {
  const env: Record<string, string> = {};
  if (words.length === 1 && words[0]!.trim() === '') return { ok: true, env };
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq <= 0) return { ok: false, error: `--env ${word}: write KEY=VALUE` };
    const key = word.slice(0, eq);
    if (key in env) return { ok: false, error: `--env ${key} given twice` };
    env[key] = word.slice(eq + 1);
  }
  return { ok: true, env };
}
