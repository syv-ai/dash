import * as fs from 'fs';
import * as path from 'path';

const DASH_DIR = '.dash';
const PORTS_FILE = 'ports.json';
const PORTS_LOCAL_FILE = 'ports.local.json';

/**
 * A single service declared in `.dash/ports.json`. Either:
 *
 *   - Tier 2 (allocated): `label` + `envVar` + `defaultPort`. Dash assigns a
 *     unique host port per worktree (defaultPort + hash offset), injects the
 *     env var, and mirrors it to `.dash/ports.env`.
 *   - Tier 1 (fixed): `label` + `port`. Dash just shows liveness — no
 *     allocation, no env injection. Useful for services on hard-coded ports.
 */
export type PortDeclaration =
  | { label: string; envVar: string; defaultPort: number }
  | { label: string; port: number };

export interface WorkspacePorts {
  /** Number of distinct port slots in the allocator's modulus. Default 50. */
  slots?: number;
  /** Spacing between adjacent slots. Default 100. */
  stride?: number;
  ports: PortDeclaration[];
}

const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(
      `[WorkspacePorts] Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
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

function parsePortEntry(raw: unknown, index: number, source: string): PortDeclaration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error(`[WorkspacePorts] ${source}: ports[${index}] must be an object`);
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) {
    console.error(`[WorkspacePorts] ${source}: ports[${index}].label must be a non-empty string`);
    return null;
  }
  const label = obj.label.trim();

  const hasEnvVar = obj.envVar !== undefined;
  const hasDefaultPort = obj.defaultPort !== undefined;
  const hasPort = obj.port !== undefined;

  if (hasPort && (hasEnvVar || hasDefaultPort)) {
    console.error(
      `[WorkspacePorts] ${source}: ports[${index}] cannot combine 'port' with 'envVar'/'defaultPort'`,
    );
    return null;
  }

  if (hasPort) {
    if (!isValidPort(obj.port)) {
      console.error(
        `[WorkspacePorts] ${source}: ports[${index}].port must be an integer in [${MIN_PORT}, ${MAX_PORT}]`,
      );
      return null;
    }
    return { label, port: obj.port };
  }

  if (!hasEnvVar || !hasDefaultPort) {
    console.error(
      `[WorkspacePorts] ${source}: ports[${index}] requires either 'port' or both 'envVar' and 'defaultPort'`,
    );
    return null;
  }
  if (typeof obj.envVar !== 'string' || !ENV_VAR_PATTERN.test(obj.envVar)) {
    console.error(
      `[WorkspacePorts] ${source}: ports[${index}].envVar must match /^[A-Z_][A-Z0-9_]*$/`,
    );
    return null;
  }
  if (!isValidPort(obj.defaultPort)) {
    console.error(
      `[WorkspacePorts] ${source}: ports[${index}].defaultPort must be an integer in [${MIN_PORT}, ${MAX_PORT}]`,
    );
    return null;
  }
  return { label, envVar: obj.envVar, defaultPort: obj.defaultPort };
}

function parseConfig(parsed: unknown, source: string): WorkspacePorts | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`[WorkspacePorts] ${source}: root must be an object`);
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.ports)) {
    console.error(`[WorkspacePorts] ${source}: 'ports' must be an array`);
    return null;
  }

  const result: WorkspacePorts = { ports: [] };

  if (obj.slots !== undefined) {
    if (!isPositiveInt(obj.slots)) {
      console.error(`[WorkspacePorts] ${source}: 'slots' must be a positive integer`);
      return null;
    }
    result.slots = obj.slots;
  }
  if (obj.stride !== undefined) {
    if (!isPositiveInt(obj.stride)) {
      console.error(`[WorkspacePorts] ${source}: 'stride' must be a positive integer`);
      return null;
    }
    result.stride = obj.stride;
  }

  const seenEnvVars = new Set<string>();
  for (let i = 0; i < obj.ports.length; i++) {
    const entry = parsePortEntry(obj.ports[i], i, source);
    if (entry === null) return null;
    if ('envVar' in entry) {
      if (seenEnvVars.has(entry.envVar)) {
        console.error(`[WorkspacePorts] ${source}: duplicate envVar '${entry.envVar}'`);
        return null;
      }
      seenEnvVars.add(entry.envVar);
    }
    result.ports.push(entry);
  }

  return result;
}

export function loadWorkspacePorts(worktreePath: string): WorkspacePorts | null {
  const filePath = path.join(worktreePath, DASH_DIR, PORTS_FILE);
  const parsed = readJson(filePath);
  if (parsed === undefined) return null;
  return parseConfig(parsed, filePath);
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
