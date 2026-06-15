import type { PermissionMode } from '../../../shared/types';
import type { WorkspaceConfig } from '../../../main/services/WorkspaceConfigService';

/** The editable shape of the Configure step / Project Settings form. */
export interface ConfigureValues {
  name: string;
  baseRef: string;
  permissionMode: PermissionMode;
  useWorktree: boolean;
  contextPrompt: string;
  setup: string; // newline-separated; split on save
  teardown: string; // newline-separated; split on save
}

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Ask every time (default)',
  acceptEdits: 'Auto-accept edits',
  bypassPermissions: 'Bypass all permissions',
};

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

const joinLines = (arr: string[] | undefined): string => (arr ?? []).join('\n');

/** Build form values from a loaded config + fallbacks (project name, detected base ref). */
export function configToValues(
  config: WorkspaceConfig | null,
  fallbacks: { name: string; baseRef: string },
): ConfigureValues {
  const td = config?.taskDefaults;
  return {
    name: fallbacks.name,
    baseRef: td?.baseRef ?? fallbacks.baseRef,
    permissionMode: td?.permissionMode ?? 'default',
    useWorktree: td?.useWorktree ?? true,
    contextPrompt: td?.contextPrompt ?? '',
    setup: joinLines(config?.setup),
    teardown: joinLines(config?.teardown),
  };
}

/** Build the `.dash/config.json` payload from form values (name is persisted separately). */
export function valuesToConfig(value: ConfigureValues): WorkspaceConfig {
  const setup = lines(value.setup);
  const teardown = lines(value.teardown);
  const taskDefaults = {
    baseRef: value.baseRef.trim() || undefined,
    permissionMode: value.permissionMode,
    useWorktree: value.useWorktree,
    contextPrompt: value.contextPrompt.trim() || undefined,
  };
  return {
    setup: setup.length > 0 ? setup : undefined,
    teardown: teardown.length > 0 ? teardown : undefined,
    taskDefaults,
  };
}
