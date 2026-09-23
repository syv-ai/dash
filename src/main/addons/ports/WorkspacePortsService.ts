import * as fs from 'fs';
import * as path from 'path';

const DASH_DIR = '.dash';
const PORTS_FILE = 'ports.json';
const PORTS_LOCAL_FILE = 'ports.local.json';

/**
 * A single service declared in `.dash/ports.json`. Either:
 *
 *   - Tier 2 (allocated): `label` + `envVar` + `defaultPort`. Dash assigns a
 *     unique host port per worktree (defaultPort + hash offset) and injects
 *     the env var into every PTY it spawns for the task.
 *   - Tier 1 (fixed): `label` + `port`. Dash just shows liveness — no
 *     allocation, no env injection. Useful for services on hard-coded ports.
 */
/** Optional repo-specific service commands, recorded by the onboarding agent. */
export interface ServiceCommands {
  /** Foreground command that starts the service (the tab doubles as logs). */
  run?: string;
  /** Stops the service when Dash didn't start it (e.g. docker compose stop X). */
  stop?: string;
  /** Tails logs for an externally-running instance. */
  logs?: string;
  /** Working directory relative to the worktree root. Default: root. */
  cwd?: string;
}

export type PortDeclaration =
  | ({ label: string; envVar: string; defaultPort: number } & ServiceCommands)
  | ({ label: string; port: number } & ServiceCommands);

export interface WorkspacePorts {
  /** Number of distinct port slots in the allocator's modulus. Default 50. */
  slots?: number;
  /** Spacing between adjacent slots. Default 100. */
  stride?: number;
  ports: PortDeclaration[];
  /**
   * Composed env vars derived from the allocated ports — templates that
   * interpolate `${PORT_VAR}` references, e.g.
   * `{ "VITE_API_URL": "http://localhost:${BACKEND_PORT}" }`. Dash evaluates
   * these against the worktree's allocated ports and emits them into both the
   * PTY env and the generated export file, so a value built from a port (an
   * API URL, a CORS origin list) is computed once and identical everywhere.
   * Every `${VAR}` must reference a declared Tier-2 port envVar.
   */
  derived?: Record<string, string>;
  /**
   * Path, relative to the worktree root, for the sourceable export file Dash
   * writes with every allocation (`export VAR='…'` lines for all Tier-2 ports
   * + derived vars). Lets tools outside a Dash PTY — pytest, alembic, compose,
   * CI — read the worktree's ports. Defaults to `.env.worktree`.
   */
  exportFile?: string;
}

const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
// Accept the full TCP range. A 1024 floor would block legitimate use cases
// like proxies bound to port 80 (Tier 1 observe-only) and services whose
// allocator hash adds enough offset to escape the privileged range. If a
// user picks an unworkable port, the failure surfaces at bind time with a
// clearer error than ours could be.
const MIN_PORT = 1;
const MAX_PORT = 65535;

// Validation errors funnel through `report` so loadWorkspacePorts can hand
// the messages back to its caller in addition to logging. Module-scoped
// because the parser is a tree of small functions and threading a reporter
// through each signature is more churn than this is worth. Reset in finally.
let captureErrors: string[] | null = null;
function report(msg: string): void {
  if (captureErrors) captureErrors.push(msg);
  console.error(`[WorkspacePorts] ${msg}`);
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    report(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isValidPort(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
  );
}

/** A path is worktree-safe if it's relative and never climbs out via `..`. */
function isSafeRelativePath(p: string): boolean {
  return !path.isAbsolute(p) && !path.normalize(p).split(path.sep).includes('..');
}

// Matches `${VAR}` interpolations in a derived template. The inner text is
// captured so we can check it resolves to a declared port env var.
const TEMPLATE_REF_PATTERN = /\$\{([^}]*)\}/g;

/**
 * Validate the optional `derived` map: composed env vars whose templates
 * interpolate declared Tier-2 port env vars. Returns null on any error (after
 * reporting it); undefined-but-valid (absent) is signalled by the caller not
 * calling this.
 */
function parseDerived(
  raw: unknown,
  portEnvVars: Set<string>,
  source: string,
): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    report(`${source}: 'derived' must be an object`);
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENV_VAR_PATTERN.test(key)) {
      report(`${source}: derived key '${key}' must match /^[A-Z_][A-Z0-9_]*$/`);
      return null;
    }
    // A derived var can't shadow a declared port var — they share the env
    // namespace and the collision would be ambiguous.
    if (portEnvVars.has(key)) {
      report(`${source}: derived key '${key}' collides with a declared port envVar`);
      return null;
    }
    if (typeof value !== 'string' || value.length === 0) {
      report(`${source}: derived['${key}'] must be a non-empty string`);
      return null;
    }
    for (const match of value.matchAll(TEMPLATE_REF_PATTERN)) {
      const ref = match[1]!;
      if (!portEnvVars.has(ref)) {
        report(
          `${source}: derived['${key}'] references \${${ref}}, which is not a declared port envVar`,
        );
        return null;
      }
    }
    out[key] = value;
  }
  return out;
}

/** Validate + collect the optional command fields. Returns null on invalid. */
function parseCommandFields(
  obj: Record<string, unknown>,
  index: number,
  source: string,
): ServiceCommands | null {
  const out: ServiceCommands = {};
  for (const key of ['run', 'stop', 'logs'] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.trim().length === 0) {
      report(`${source}: ports[${index}].${key} must be a non-empty string`);
      return null;
    }
    out[key] = v.trim();
  }
  if (obj.cwd !== undefined) {
    if (typeof obj.cwd !== 'string' || obj.cwd.trim().length === 0) {
      report(`${source}: ports[${index}].cwd must be a non-empty string`);
      return null;
    }
    const cwd = obj.cwd.trim();
    if (!isSafeRelativePath(cwd)) {
      report(`${source}: ports[${index}].cwd must be a relative path inside the worktree`);
      return null;
    }
    out.cwd = cwd;
  }
  return out;
}

function parsePortEntry(raw: unknown, index: number, source: string): PortDeclaration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    report(`${source}: ports[${index}] must be an object`);
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) {
    report(`${source}: ports[${index}].label must be a non-empty string`);
    return null;
  }
  const label = obj.label.trim();

  const commands = parseCommandFields(obj, index, source);
  if (commands === null) return null;

  const hasEnvVar = obj.envVar !== undefined;
  const hasDefaultPort = obj.defaultPort !== undefined;
  const hasPort = obj.port !== undefined;

  if (hasPort && (hasEnvVar || hasDefaultPort)) {
    report(`${source}: ports[${index}] cannot combine 'port' with 'envVar'/'defaultPort'`);
    return null;
  }

  if (hasPort) {
    if (!isValidPort(obj.port)) {
      report(`${source}: ports[${index}].port must be an integer in [${MIN_PORT}, ${MAX_PORT}]`);
      return null;
    }
    return { label, port: obj.port, ...commands };
  }

  if (!hasEnvVar || !hasDefaultPort) {
    report(`${source}: ports[${index}] requires either 'port' or both 'envVar' and 'defaultPort'`);
    return null;
  }
  if (typeof obj.envVar !== 'string' || !ENV_VAR_PATTERN.test(obj.envVar)) {
    report(`${source}: ports[${index}].envVar must match /^[A-Z_][A-Z0-9_]*$/`);
    return null;
  }
  if (!isValidPort(obj.defaultPort)) {
    report(
      `${source}: ports[${index}].defaultPort must be an integer in [${MIN_PORT}, ${MAX_PORT}]`,
    );
    return null;
  }
  return { label, envVar: obj.envVar, defaultPort: obj.defaultPort, ...commands };
}

function parseConfig(parsed: unknown, source: string): WorkspacePorts | null {
  // Accept either the canonical `{ ports: [...], slots?, stride? }` shape or
  // a bare top-level array. The bare-array shape is a natural reading of
  // "the schema has two entry shapes" — agents writing this file for the
  // first time sometimes infer the collection IS the array. We prefer to
  // be liberal in what we accept here; slots/stride aren't expressible in
  // the bare form but their defaults are fine for almost every project.
  let portsArr: unknown;
  let obj: Record<string, unknown> | null = null;
  if (Array.isArray(parsed)) {
    portsArr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    obj = parsed as Record<string, unknown>;
    portsArr = obj.ports;
  } else {
    report(`${source}: root must be an object or an array`);
    return null;
  }

  if (!Array.isArray(portsArr)) {
    report(`${source}: 'ports' must be an array`);
    return null;
  }

  const result: WorkspacePorts = { ports: [] };

  if (obj?.slots !== undefined) {
    if (!isPositiveInt(obj.slots)) {
      report(`${source}: 'slots' must be a positive integer`);
      return null;
    }
    result.slots = obj.slots;
  }
  if (obj?.stride !== undefined) {
    if (!isPositiveInt(obj.stride)) {
      report(`${source}: 'stride' must be a positive integer`);
      return null;
    }
    result.stride = obj.stride;
  }

  const seenEnvVars = new Set<string>();
  const seenLabels = new Set<string>();
  for (let i = 0; i < portsArr.length; i++) {
    const entry = parsePortEntry(portsArr[i], i, source);
    if (entry === null) return null;
    // Labels key the service-runner's ownership map and tab ids — duplicates
    // would collide.
    if (seenLabels.has(entry.label)) {
      report(`${source}: duplicate label '${entry.label}'`);
      return null;
    }
    seenLabels.add(entry.label);
    if ('envVar' in entry) {
      if (seenEnvVars.has(entry.envVar)) {
        report(`${source}: duplicate envVar '${entry.envVar}'`);
        return null;
      }
      seenEnvVars.add(entry.envVar);
    }
    result.ports.push(entry);
  }

  if (obj?.derived !== undefined) {
    const derived = parseDerived(obj.derived, seenEnvVars, source);
    if (derived === null) return null;
    if (Object.keys(derived).length > 0) result.derived = derived;
  }

  if (obj?.exportFile !== undefined) {
    if (typeof obj.exportFile !== 'string' || obj.exportFile.trim().length === 0) {
      report(`${source}: 'exportFile' must be a non-empty string`);
      return null;
    }
    const exportFile = obj.exportFile.trim();
    if (!isSafeRelativePath(exportFile)) {
      report(`${source}: 'exportFile' must be a relative path inside the worktree`);
      return null;
    }
    result.exportFile = exportFile;
  }

  return result;
}

export function loadWorkspacePorts(worktreePath: string, errors?: string[]): WorkspacePorts | null {
  captureErrors = errors ?? null;
  try {
    const filePath = path.join(worktreePath, DASH_DIR, PORTS_FILE);
    const parsed = readJson(filePath);
    if (parsed === undefined) return null;
    return parseConfig(parsed, filePath);
  } finally {
    captureErrors = null;
  }
}

/**
 * Load per-developer port pins from `.dash/ports.local.json`. Format:
 *
 *   { "overrides": { "FRONTEND_PORT": 5173, ... } }
 *
 * Entries with invalid env-var names or out-of-range ports are silently
 * dropped — the local file is gitignored noise, not a contract.
 */
export function loadPortOverrides(worktreePath: string): Record<string, number> {
  const filePath = path.join(worktreePath, DASH_DIR, PORTS_LOCAL_FILE);
  const parsed = readJson(filePath);
  if (parsed === undefined || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.overrides || typeof obj.overrides !== 'object' || Array.isArray(obj.overrides)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj.overrides as Record<string, unknown>)) {
    if (!ENV_VAR_PATTERN.test(key)) continue;
    if (!isValidPort(value)) continue;
    result[key] = value;
  }
  return result;
}
