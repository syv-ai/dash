import os from 'os';
import path from 'path';
import type { Project } from '../../shared/types';
import type { Caller } from './callers';
import { ControlError, type CapabilityListing, type Registry } from './registry';

/*
 * `dashctl`, the control API's command line. The `dashctl` script only carries
 * words: it posts its argv (and stdin, when asked) to `/v1/cli`, and this
 * module turns them into a capability call and its answer into text. So the
 * commands are always the running Dash's, whatever version wrote the script.
 *
 *   dashctl <namespace> <verb> [args] [--flag value]
 *
 * 'tasks.create' is `dashctl tasks create`, 'review.drafts_create' is
 * `dashctl review drafts-create`. Every input is a flag (`--task-id` or
 * `--taskId`); the capability's `cli.args` are positional too. Its `cli.stdin`
 * input is read from stdin when given as `-`, or when it is required and not
 * given; an optional one is never read implicitly, so a stdin the agent's
 * shell happens to hold is never swallowed. `--project` takes a project's id,
 * name or path (relative to the caller's working directory).
 */

/** What `/v1/cli` answers: the status decides where the script prints it. */
export interface CliAnswer {
  /** 200 result · 400 usage · 422 refused · 428 send stdin (nothing ran) */
  status: 200 | 400 | 422 | 428;
  text: string;
}

interface PropSchema {
  type?: string;
  enum?: unknown[];
  description?: string;
}
interface ObjectSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

const kebab = (s: string) => s.replace(/_/g, '-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const words = (capability: string) => {
  const [ns, verb] = capability.split('.');
  return [ns!, kebab(verb!)];
};

/** The command a capability is, after `dashctl`: 'review.drafts_create' → 'review drafts-create'. */
export const commandName = (capability: string): string => words(capability).join(' ');
const propsOf = (c: CapabilityListing) => (c.inputSchema as ObjectSchema).properties ?? {};
const requiredOf = (c: CapabilityListing) =>
  new Set((c.inputSchema as ObjectSchema).required ?? []);
const firstSentence = (s: string) => s.match(/^.*?[.:](?=\s|$)/)?.[0] ?? s;

/** The flag an input is given as; `projectId` is `--project`. */
const flagFor = (prop: string) => (prop === 'projectId' ? 'project' : kebab(prop));

function placeholder(prop: string, schema: PropSchema): string {
  if (schema.enum) return schema.enum.join('|');
  if (schema.type === 'boolean') return '';
  return `<${flagFor(prop)}>`;
}

/** One command's line: positionals, required flags, then `[options]`. */
export function commandLine(c: CapabilityListing): string {
  const props = propsOf(c);
  const required = requiredOf(c);
  const args = c.cli?.args ?? [];
  const parts = ['dashctl', ...words(c.name)];
  for (const a of args) parts.push(required.has(a) ? `<${flagFor(a)}>` : `[${flagFor(a)}]`);
  let optional = false;
  for (const [prop, schema] of Object.entries(props)) {
    if (args.includes(prop)) continue;
    if (required.has(prop) && prop !== c.cli?.stdin) {
      parts.push(`--${flagFor(prop)} ${placeholder(prop, schema)}`.trimEnd());
    } else optional = true;
  }
  if (c.cli?.stdin && required.has(c.cli.stdin)) parts.push(`(${flagFor(c.cli.stdin)} on stdin)`);
  if (optional) parts.push('[options]');
  return parts.join(' ');
}

/** `dashctl help` (and bare `dashctl`): every command, one line and a sentence each. */
export function usageText(commands: CapabilityListing[]): string {
  const lines = ['usage: dashctl <namespace> <verb> [arguments] [--flag value]', ''];
  for (const c of commands) lines.push(commandLine(c), `    ${firstSentence(c.summary)}`);
  lines.push(
    '',
    'Run a command with --help for its flags. Results are JSON; a refusal goes to stderr.',
  );
  return lines.join('\n');
}

/** `dashctl <ns> <verb> --help`: the command's line, summary and every flag. */
export function helpText(c: CapabilityListing): string {
  const required = requiredOf(c);
  const lines = [commandLine(c), '', c.summary, ''];
  for (const [prop, schema] of Object.entries(propsOf(c))) {
    const flag = `--${flagFor(prop)} ${placeholder(prop, schema)}`.trimEnd();
    const notes = [
      required.has(prop) ? 'required' : '',
      c.cli?.stdin === prop ? (required.has(prop) ? 'or stdin' : '- reads stdin') : '',
      prop === 'projectId' ? 'id, name or path' : '',
    ].filter(Boolean);
    const desc = [schema.description, notes.length ? `(${notes.join(', ')})` : '']
      .filter(Boolean)
      .join(' ');
    lines.push(`  ${flag}`, ...(desc ? [`      ${desc}`] : []));
  }
  return lines.join('\n');
}

class UsageError extends Error {}

/**
 * A project by id, name (any case) or path: `~` is the home folder, and a
 * relative path is the caller's `cwd` (none from an old script: absolute
 * paths only). Throws a usage error for a name two projects share.
 */
export function findProject(
  projects: Project[],
  ref: string,
  cwd: string | null = null,
): Project | undefined {
  const byId = projects.find((p) => p.id === ref);
  if (byId) return byId;
  const lower = ref.toLowerCase();
  const byName = projects.filter((p) => p.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new UsageError(
      `${byName.length} projects are named ${JSON.stringify(ref)}; give its path or id (${byName.map((p) => p.id).join(', ')})`,
    );
  }
  const expanded =
    ref === '~' || ref.startsWith('~/') ? path.join(os.homedir(), ref.slice(1)) : ref;
  if (!path.isAbsolute(expanded) && cwd === null) return undefined;
  const resolved = path.resolve(cwd ?? '/', expanded);
  return projects.find((p) => path.resolve(p.path) === resolved);
}

function coerce(prop: string, schema: PropSchema, value: string | true): unknown {
  if (schema.type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === 'false') return false;
    throw new UsageError(`--${flagFor(prop)} takes true or false`);
  }
  if (value === true) throw new UsageError(`--${flagFor(prop)} needs a value`);
  if (schema.type === 'integer' || schema.type === 'number') {
    const n = Number(value);
    if (value.trim() === '' || Number.isNaN(n)) {
      throw new UsageError(`--${flagFor(prop)} takes a number`);
    }
    return n;
  }
  return value;
}

const isHelp = (word: string) => word === '--help' || word === '-h';

type Parsed =
  | { kind: 'usage'; text: string }
  | { kind: 'help'; text: string }
  | { kind: 'stdin' }
  | { kind: 'call'; name: string; input: Record<string, unknown> };

/**
 * Turn argv (and stdin, once sent) into a call, or say why not. `cwd` is the
 * caller's working directory, for a relative `--project` path. Pure.
 */
export function resolveArgv(
  argv: string[],
  commands: CapabilityListing[],
  stdin: string | null,
  projects: Project[],
  cwd: string | null = null,
): Parsed {
  // Bare is a usage error (like git); asking for help is an answer.
  if (argv.length === 0) return { kind: 'usage', text: usageText(commands) };
  if (argv.length === 1 && (argv[0] === 'help' || isHelp(argv[0]!))) {
    return { kind: 'help', text: usageText(commands) };
  }
  const [ns, verb, ...rest] = argv;
  const c = commands.find((x) => {
    const [n, v] = words(x.name);
    return n === ns && v === kebab(verb ?? '');
  });
  if (!c) {
    const inNs = commands.filter((x) => words(x.name)[0] === ns);
    const known = (inNs.length ? inNs : commands).map(commandLine);
    const what = verb ? `${ns} ${verb}` : ns;
    return { kind: 'usage', text: `dashctl: no command ${what}\n\n${known.join('\n')}` };
  }
  try {
    const props = propsOf(c);
    const byFlag = new Map<string, string>();
    for (const prop of Object.keys(props)) {
      byFlag.set(flagFor(prop), prop);
      byFlag.set(prop, prop);
      byFlag.set(kebab(prop), prop);
    }
    const input: Record<string, unknown> = {};
    const raw: Record<string, string | true> = {};
    const positional: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const word = rest[i]!;
      if (word === '--') {
        positional.push(...rest.slice(i + 1));
        break;
      }
      if (word === '--json') continue; // results are always JSON
      // Only here, not as a flag's value: `--prompt --help` is a prompt.
      if (isHelp(word)) return { kind: 'help', text: helpText(c) };
      if (!word.startsWith('--')) {
        positional.push(word);
        continue;
      }
      const eq = word.indexOf('=');
      const flag = word.slice(2, eq < 0 ? undefined : eq);
      const prop = byFlag.get(flag);
      if (!prop) throw new UsageError(`unknown flag --${flag}`);
      if (prop in raw) throw new UsageError(`--${flagFor(prop)} given twice`);
      if (eq >= 0) raw[prop] = word.slice(eq + 1);
      else if (props[prop]!.type === 'boolean') {
        const next = rest[i + 1];
        raw[prop] = next === 'true' || next === 'false' ? (i++, next) : true;
      } else if (i + 1 < rest.length) raw[prop] = rest[++i]!;
      else throw new UsageError(`--${flagFor(prop)} needs a value`);
    }
    const args = c.cli?.args ?? [];
    if (positional.length > args.length) {
      throw new UsageError(`unexpected argument ${JSON.stringify(positional[args.length])}`);
    }
    positional.forEach((value, i) => {
      const prop = args[i]!;
      if (prop in raw) throw new UsageError(`${flagFor(prop)} given twice`);
      raw[prop] = value;
    });
    const fromStdin = c.cli?.stdin;
    const readStdin =
      fromStdin !== undefined &&
      (raw[fromStdin] === '-' || (!(fromStdin in raw) && requiredOf(c).has(fromStdin)));
    if (readStdin) delete raw[fromStdin!];
    for (const [prop, value] of Object.entries(raw)) {
      input[prop] = coerce(prop, props[prop]!, value);
    }

    if (readStdin) {
      if (stdin === null) return { kind: 'stdin' };
      // A heredoc ends in a newline the writer didn't mean.
      const text = stdin.replace(/\r?\n$/, '');
      if (text !== '') input[fromStdin!] = text;
    }
    if (typeof input.projectId === 'string') {
      const project = findProject(projects, input.projectId, cwd);
      if (!project) {
        throw new UsageError(
          `no project ${JSON.stringify(input.projectId)}; dashctl projects list names them`,
        );
      }
      input.projectId = project.id;
    }
    const missing = [...requiredOf(c)].filter((p) => !(p in input));
    if (missing.length > 0) {
      throw new UsageError(`missing ${missing.map((p) => `--${flagFor(p)}`).join(', ')}`);
    }
    return { kind: 'call', name: c.name, input };
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    // A help flag the parse didn't reach (`--bogus --help`) still asks for help.
    if (rest.some(isHelp)) return { kind: 'help', text: helpText(c) };
    return {
      kind: 'usage',
      text: `dashctl ${words(c.name).join(' ')}: ${err.message}\nusage: ${commandLine(c)}`,
    };
  }
}

/** A result as text: plain text as is, anything else as compact JSON (it lands in an
 *  agent's context). */
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    Object.keys(result).length === 1 &&
    typeof (result as { text?: unknown }).text === 'string'
  ) {
    return (result as { text: string }).text;
  }
  return JSON.stringify(result ?? null);
}

/** Answer one `dashctl` run for the caller. */
export async function runCli(
  registry: Pick<Registry, 'listFor' | 'call' | 'projectsFor'>,
  caller: Caller,
  argv: string[],
  stdin: string | null,
  cwd: string | null = null,
): Promise<CliAnswer> {
  const commands = registry.listFor(caller);
  const parsed = resolveArgv(argv, commands, stdin, registry.projectsFor(caller), cwd);
  switch (parsed.kind) {
    case 'usage':
      return { status: 400, text: parsed.text };
    case 'help':
      return { status: 200, text: parsed.text };
    case 'stdin':
      return { status: 428, text: '' };
  }
  const label = `dashctl ${words(parsed.name).join(' ')}`;
  try {
    return {
      status: 200,
      text: resultText(await registry.call(caller, parsed.name, parsed.input)),
    };
  } catch (err) {
    if (err instanceof ControlError) return { status: 422, text: `${label}: ${err.message}` };
    throw err;
  }
}
