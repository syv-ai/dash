import * as fs from 'fs';
import * as path from 'path';
import { isPermissionMode, type PermissionMode } from '../../shared/types';

const DASH_DIR = '.dash';
const CONFIG_FILE = 'config.json';
const LOCAL_CONFIG_FILE = 'config.local.json';

export interface WorkspaceTaskDefaults {
  baseRef?: string;
  permissionMode?: PermissionMode;
  useWorktree?: boolean;
  contextPrompt?: string;
  /** Default for a new task's Dash access (dashctl, the control API). */
  dashAccess?: boolean;
  /** Default extra `claude` flags for a new task. Read from
   *  `config.local.json` only, so a cloned repo can't plant flags. */
  extraArgs?: string;
}

/** taskDefaults keys only `config.local.json` may set. */
export const LOCAL_ONLY_TASK_DEFAULTS = ['extraArgs'] as const;
export type LocalTaskDefaults = Pick<
  WorkspaceTaskDefaults,
  (typeof LOCAL_ONLY_TASK_DEFAULTS)[number]
>;

export interface WorkspaceConfig {
  taskDefaults?: WorkspaceTaskDefaults;
  /** Read from config.json only: local-only keys it sets, which were ignored
   *  (Project settings says so). Never written. */
  ignoredLocalOnlyKeys?: string[];
}

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

function parseTaskDefaults(
  value: unknown,
  source: string,
  opts: { local: boolean },
): WorkspaceTaskDefaults | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    console.error(`[WorkspaceConfig] ${source}: 'taskDefaults' must be an object`);
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const result: WorkspaceTaskDefaults = {};
  if (typeof obj.baseRef === 'string' && obj.baseRef.trim()) result.baseRef = obj.baseRef.trim();
  if (isPermissionMode(obj.permissionMode)) result.permissionMode = obj.permissionMode;
  if (typeof obj.useWorktree === 'boolean') result.useWorktree = obj.useWorktree;
  if (typeof obj.contextPrompt === 'string') result.contextPrompt = obj.contextPrompt;
  if (typeof obj.dashAccess === 'boolean') result.dashAccess = obj.dashAccess;
  if (opts.local && typeof obj.extraArgs === 'string' && obj.extraArgs.trim()) {
    result.extraArgs = obj.extraArgs.trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** The local-only taskDefaults keys a shared config.json sets anyway. */
function localOnlyKeysIn(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return LOCAL_ONLY_TASK_DEFAULTS.filter((k) => k in value).map((k) => `taskDefaults.${k}`);
}

function parseBaseConfig(parsed: unknown, source: string): WorkspaceConfig | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const result: WorkspaceConfig = {};
  const taskDefaults = parseTaskDefaults(obj.taskDefaults, source, { local: false });
  if (taskDefaults) result.taskDefaults = taskDefaults;
  const ignored = localOnlyKeysIn(obj.taskDefaults);
  if (ignored.length > 0) result.ignoredLocalOnlyKeys = ignored;
  return result;
}

function applyLocalOverlay(
  base: WorkspaceConfig,
  overlay: Record<string, unknown>,
): WorkspaceConfig {
  const result: WorkspaceConfig = { ...base };
  // Local taskDefaults win key by key, so a personal override of one default
  // (e.g. dashAccess) keeps the shared rest.
  const localDefaults = parseTaskDefaults(overlay.taskDefaults, LOCAL_CONFIG_FILE, {
    local: true,
  });
  if (localDefaults) result.taskDefaults = { ...base.taskDefaults, ...localDefaults };
  return result;
}

/**
 * Read `.dash/config.json` alone, without the `config.local.json` overlay. For
 * editors that write config.json back, so a personal override never leaks into
 * the shared file.
 */
export function loadSharedWorkspaceConfig(worktreePath: string): WorkspaceConfig | null {
  const configPath = path.join(worktreePath, DASH_DIR, CONFIG_FILE);
  const parsed = readJson(configPath);
  if (parsed === undefined) return null;
  return parseBaseConfig(parsed, configPath);
}

/**
 * The effective config: config.json with config.local.json overlaid. A missing
 * config.json overlays onto an empty config (a personal-only local file still
 * applies); a broken one gives null. Null too when neither file exists.
 */
export function loadWorkspaceConfig(worktreePath: string): WorkspaceConfig | null {
  const hasShared = fs.existsSync(path.join(worktreePath, DASH_DIR, CONFIG_FILE));
  const base = hasShared ? loadSharedWorkspaceConfig(worktreePath) : {};
  if (base === null) return null;
  const noOverlay = hasShared ? base : null;

  const localPath = path.join(worktreePath, DASH_DIR, LOCAL_CONFIG_FILE);
  const localParsed = readJson(localPath);
  if (localParsed === undefined) return noOverlay;
  if (!localParsed || typeof localParsed !== 'object' || Array.isArray(localParsed)) {
    return noOverlay;
  }

  return applyLocalOverlay(base, localParsed as Record<string, unknown>);
}

/** `.dash/config.local.json`'s local-only task defaults alone (Project settings' personal section). */
export function loadLocalTaskDefaults(projectPath: string): LocalTaskDefaults {
  const parsed = readJson(path.join(projectPath, DASH_DIR, LOCAL_CONFIG_FILE));
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const all = parseTaskDefaults((obj as Record<string, unknown>).taskDefaults, LOCAL_CONFIG_FILE, {
    local: true,
  });
  const result: LocalTaskDefaults = {};
  for (const key of LOCAL_ONLY_TASK_DEFAULTS) {
    if (all?.[key] !== undefined) result[key] = all[key];
  }
  return result;
}

/**
 * Set the local-only task defaults in `.dash/config.local.json`, keeping every
 * other key there (a personal dashAccess override, custom keys). An empty or
 * undefined value removes its key. The caller keeps the file out of git
 * (`.git/info/exclude`): it is the person's own.
 */
export function writeLocalTaskDefaults(projectPath: string, patch: LocalTaskDefaults): void {
  const dashDir = path.join(projectPath, DASH_DIR);
  const localPath = path.join(dashDir, LOCAL_CONFIG_FILE);
  const existing = readJson(localPath);
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const prev = base.taskDefaults;
  const defaults: Record<string, unknown> =
    prev && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  for (const key of LOCAL_ONLY_TASK_DEFAULTS) {
    const value = patch[key]?.trim();
    if (value) defaults[key] = value;
    else delete defaults[key];
  }
  if (Object.keys(defaults).length > 0) base.taskDefaults = defaults;
  else delete base.taskDefaults;

  if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(localPath, JSON.stringify(base, null, 2) + '\n', 'utf-8');
}

/**
 * Persist a WorkspaceConfig to `<projectPath>/.dash/config.json`, preserving any
 * keys we don't model (e.g. custom keys). Only taskDefaults is overwritten from
 * `config`; passing `undefined` for it removes it.
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
  assign('taskDefaults');

  if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(base, null, 2) + '\n', 'utf-8');
}
