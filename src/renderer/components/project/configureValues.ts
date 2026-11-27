import type { PermissionMode } from '../../../shared/types';
import type {
  LocalTaskDefaults,
  WorkspaceConfig,
} from '../../../main/services/WorkspaceConfigService';
import { validateExtraArgs } from '../../../shared/extraArgs';

/** The editable shape of the Project Settings form. */
export interface ConfigureValues {
  name: string;
  baseRef: string;
  permissionMode: PermissionMode;
  useWorktree: boolean;
  contextPrompt: string;
  /** Default for the New Task dialog's Dash access switch. */
  dashAccess: boolean;
}

/** Build form values from a loaded config + fallbacks (project name, detected base ref). */
export function configToValues(
  config: WorkspaceConfig | null,
  fallbacks: { name: string; baseRef: string },
): ConfigureValues {
  const td = config?.taskDefaults;
  return {
    name: fallbacks.name,
    baseRef: td?.baseRef ?? fallbacks.baseRef,
    permissionMode: td?.permissionMode ?? 'auto',
    useWorktree: td?.useWorktree ?? true,
    contextPrompt: td?.contextPrompt ?? '',
    dashAccess: td?.dashAccess ?? false,
  };
}

/** Build the `.dash/config.json` payload from form values (name is persisted separately). */
export function valuesToConfig(value: ConfigureValues): WorkspaceConfig {
  const taskDefaults = {
    baseRef: value.baseRef.trim() || undefined,
    // Auto is the built-in default, so saving a config with no mode doesn't
    // write one into the committed file.
    permissionMode: value.permissionMode === 'auto' ? undefined : value.permissionMode,
    useWorktree: value.useWorktree,
    contextPrompt: value.contextPrompt.trim() || undefined,
    // Off is the built-in default, so only an opt-in is written.
    dashAccess: value.dashAccess || undefined,
  };
  return { taskDefaults };
}

/** The personal, local-only defaults (`.dash/config.local.json`) as the form edits them. */
export interface LocalValues {
  extraArgs: string;
}

export function localToValues(defaults: LocalTaskDefaults | undefined): LocalValues {
  return { extraArgs: defaults?.extraArgs ?? '' };
}

/** Empty fields are dropped (main removes their keys). */
export function valuesToLocal(value: LocalValues): LocalTaskDefaults {
  return { extraArgs: value.extraArgs.trim() || undefined };
}

/** Whether the form can be saved: extra arguments a task could launch with. */
export function localValuesOk(value: LocalValues): boolean {
  return validateExtraArgs(value.extraArgs).ok;
}
