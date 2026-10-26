import * as fs from 'fs';
import * as path from 'path';
import type { PermissionMode } from '@shared/types';
import { claudeUserSettingsFile } from '../utils/claudePaths';

// Loosely typed: every value comes from a user-edited file.
interface ClaudeSettings {
  permissions?: { defaultMode?: unknown };
  attribution?: { commit?: unknown };
}

function readSettings(file: string): ClaudeSettings | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ClaudeSettings;
  } catch {
    // Missing or broken: Claude Code skips the file too.
    return undefined;
  }
}

/**
 * One setting as Claude Code resolves it: the project's settings.local.json,
 * then its settings.json, then the user settings. The first file that sets it
 * decides; undefined when none does.
 */
export function readClaudeSetting(
  projectPath: string | undefined,
  pick: (settings: ClaudeSettings) => unknown,
): unknown {
  const files = [
    ...(projectPath
      ? [
          path.join(projectPath, '.claude', 'settings.local.json'),
          path.join(projectPath, '.claude', 'settings.json'),
        ]
      : []),
    claudeUserSettingsFile(),
  ];
  for (const file of files) {
    const settings = readSettings(file);
    const value = settings && pick(settings);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Claude Code's `defaultMode` values Dash has a mode for. `manual` is the
 *  CLI's newer name for `default`; `plan` and `dontAsk` have no Dash mode. */
const DASH_MODE = new Map<unknown, PermissionMode>([
  ['default', 'default'],
  ['manual', 'default'],
  ['acceptEdits', 'acceptEdits'],
  ['auto', 'auto'],
  ['bypassPermissions', 'bypassPermissions'],
]);

/**
 * The `permissions.defaultMode` the user set in Claude Code's settings, as a
 * Dash mode, or undefined when none is set or Dash has no matching mode.
 * Dash dispatches every task with an explicit mode, which overrides this
 * setting, so a new task starts from it instead.
 */
export function claudeDefaultPermissionMode(projectPath?: string): PermissionMode | undefined {
  return DASH_MODE.get(readClaudeSetting(projectPath, (s) => s.permissions?.defaultMode));
}
