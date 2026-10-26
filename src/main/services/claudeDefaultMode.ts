import * as fs from 'fs';
import * as path from 'path';
import type { PermissionMode } from '@shared/types';
import { claudeUserSettingsFile } from '../utils/claudePaths';

/** Claude Code's `defaultMode` values Dash has a mode for. `manual` is the
 *  CLI's newer name for `default`; `plan` and `dontAsk` have no Dash mode. */
const DASH_MODE = new Map<unknown, PermissionMode>([
  ['default', 'default'],
  ['manual', 'default'],
  ['acceptEdits', 'acceptEdits'],
  ['auto', 'auto'],
  ['bypassPermissions', 'bypassPermissions'],
]);

function readDefaultMode(file: string): unknown {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (parsed as { permissions?: { defaultMode?: unknown } })?.permissions?.defaultMode;
  } catch {
    return undefined;
  }
}

/**
 * The `permissions.defaultMode` the user set in Claude Code's settings, as a
 * Dash mode, or undefined when none is set or Dash has no matching mode.
 * Dash dispatches every task with an explicit mode, which overrides this
 * setting, so a new task starts from it instead. Claude Code's precedence:
 * the project's settings.local.json, its settings.json, then user settings.
 */
export function claudeDefaultPermissionMode(projectPath?: string): PermissionMode | undefined {
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
    const mode = readDefaultMode(file);
    // The first file that sets it decides, even with a mode Dash lacks.
    if (mode !== undefined) return DASH_MODE.get(mode);
  }
  return undefined;
}
