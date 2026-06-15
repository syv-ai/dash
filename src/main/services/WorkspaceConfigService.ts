import * as fs from 'fs';
import * as path from 'path';
import type { PermissionMode } from '../../shared/types';

const DASH_DIR = '.dash';
const CONFIG_FILE = 'config.json';
const LOCAL_CONFIG_FILE = 'config.local.json';

const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions'];

export interface WorkspaceTaskDefaults {
  baseRef?: string;
  permissionMode?: PermissionMode;
  useWorktree?: boolean;
  contextPrompt?: string;
}

export interface WorkspaceConfig {
  setup?: string[];
  teardown?: string[];
  run?: string[];
  cwd?: string;
  taskDefaults?: WorkspaceTaskDefaults;
}

const SCRIPT_KEYS = ['setup', 'teardown', 'run'] as const;
type ScriptKey = (typeof SCRIPT_KEYS)[number];

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(
      `[WorkspaceConfig] Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parseTaskDefaults(value: unknown, source: string): WorkspaceTaskDefaults | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    console.error(`[WorkspaceConfig] ${source}: 'taskDefaults' must be an object`);
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const result: WorkspaceTaskDefaults = {};
  if (typeof obj.baseRef === 'string' && obj.baseRef.trim()) result.baseRef = obj.baseRef.trim();
  if (PERMISSION_MODES.includes(obj.permissionMode as PermissionMode)) {
    result.permissionMode = obj.permissionMode as PermissionMode;
  }
  if (typeof obj.useWorktree === 'boolean') result.useWorktree = obj.useWorktree;
  if (typeof obj.contextPrompt === 'string') result.contextPrompt = obj.contextPrompt;
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseBaseConfig(parsed: unknown, source: string): WorkspaceConfig | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const result: WorkspaceConfig = {};

  for (const key of SCRIPT_KEYS) {
    const value = obj[key];
    if (value === undefined) continue;
    if (!isStringArray(value)) {
      console.error(`[WorkspaceConfig] ${source}: '${key}' must be an array of strings`);
      return null;
    }
    result[key] = value;
  }

  if (obj.cwd !== undefined) {
    if (typeof obj.cwd !== 'string' || obj.cwd.trim().length === 0) {
      console.error(`[WorkspaceConfig] ${source}: 'cwd' must be a non-empty string`);
      return null;
    }
    result.cwd = obj.cwd.trim();
  }

  const taskDefaults = parseTaskDefaults(obj.taskDefaults, source);
  if (taskDefaults) result.taskDefaults = taskDefaults;

  return result;
}

interface SandwichMerge {
  before?: string[];
  after?: string[];
}

function asSandwich(value: unknown): SandwichMerge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const result: SandwichMerge = {};
  if (obj.before !== undefined) {
    if (!isStringArray(obj.before)) return null;
    result.before = obj.before;
  }
  if (obj.after !== undefined) {
    if (!isStringArray(obj.after)) return null;
    result.after = obj.after;
  }
  return result;
}

function applyLocalOverlay(
  base: WorkspaceConfig,
  overlay: Record<string, unknown>,
): WorkspaceConfig {
  const result: WorkspaceConfig = { ...base };
  for (const key of SCRIPT_KEYS) {
    const value = overlay[key];
    if (value === undefined) continue;
    if (isStringArray(value)) {
      result[key] = value;
      continue;
    }
    const sandwich = asSandwich(value);
    if (sandwich !== null) {
      result[key] = [...(sandwich.before ?? []), ...(base[key] ?? []), ...(sandwich.after ?? [])];
    }
  }
  return result;
}

export function getResolvedSetupCommands(config: WorkspaceConfig | null): string[] {
  if (!config?.setup) return [];
  return config.setup.filter((cmd) => cmd.trim().length > 0);
}

/** POSIX single-quote escape: safe for any path passed through a shell. */
function singleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface ResolveLifecycleArgs {
  config: WorkspaceConfig | null;
  fallbackScriptPath: string | null;
}

function resolveLifecycleCommand(
  commands: string[] | undefined,
  fallbackScriptPath: string | null,
): string | null {
  const filtered = (commands ?? []).filter((c) => c.trim().length > 0);
  if (filtered.length > 0) return filtered.join(' && ');
  if (fallbackScriptPath) return `bash ${singleQuote(fallbackScriptPath)}`;
  return null;
}

/**
 * Pick the shell command to run for workspace setup, or null for no-op.
 * Config setup wins over the fallback script. Commands joined with " && "
 * so any failure short-circuits.
 */
export function resolveSetupCommand(args: ResolveLifecycleArgs): string | null {
  return resolveLifecycleCommand(args.config?.setup, args.fallbackScriptPath);
}

/**
 * Pick the shell command to run for workspace teardown, or null for no-op.
 * Mirrors resolveSetupCommand but reads `teardown` instead.
 */
export function resolveTeardownCommand(args: ResolveLifecycleArgs): string | null {
  return resolveLifecycleCommand(args.config?.teardown, args.fallbackScriptPath);
}

export interface WorkspaceEnvArgs {
  worktreePath: string;
  projectPath: string;
  /** Task UUID — omitted for one-shot setup-script context where the task row may not yet exist. */
  taskId?: string;
  branch?: string;
}

export function buildWorkspaceEnv(args: WorkspaceEnvArgs): Record<string, string> {
  const env: Record<string, string> = {
    DASH_WORKTREE_PATH: args.worktreePath,
    DASH_PROJECT_PATH: args.projectPath,
  };
  if (args.taskId) env.DASH_TASK_ID = args.taskId;
  if (args.branch) env.DASH_BRANCH = args.branch;
  return env;
}

export function loadWorkspaceConfig(worktreePath: string): WorkspaceConfig | null {
  const configPath = path.join(worktreePath, DASH_DIR, CONFIG_FILE);
  const parsed = readJson(configPath);
  if (parsed === undefined) return null;
  const base = parseBaseConfig(parsed, configPath);
  if (base === null) return null;

  const localPath = path.join(worktreePath, DASH_DIR, LOCAL_CONFIG_FILE);
  const localParsed = readJson(localPath);
  if (localParsed === undefined) return base;
  if (!localParsed || typeof localParsed !== 'object' || Array.isArray(localParsed)) return base;

  return applyLocalOverlay(base, localParsed as Record<string, unknown>);
}

/**
 * Persist a WorkspaceConfig to `<projectPath>/.dash/config.json`, preserving any
 * keys we don't model (e.g. custom keys). Only setup/teardown/cwd/taskDefaults
 * are overwritten from `config`; passing `undefined` for one of those removes it.
 */
export function writeWorkspaceConfig(projectPath: string, config: WorkspaceConfig): void {
  const dashDir = path.join(projectPath, DASH_DIR);
  const configPath = path.join(dashDir, CONFIG_FILE);
  const existing = readJson(configPath);
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const assign = (key: keyof WorkspaceConfig) => {
    if (config[key] === undefined) delete base[key];
    else base[key] = config[key];
  };
  assign('setup');
  assign('teardown');
  assign('cwd');
  assign('taskDefaults');

  if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(base, null, 2) + '\n', 'utf-8');
}
