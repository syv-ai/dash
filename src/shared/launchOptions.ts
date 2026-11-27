import { addDirProblem } from './addDirs';
import { flagNoteText, validateExtraArgs } from './extraArgs';

/**
 * Why a task's launch options can't be saved (the flags a dispatch would then
 * refuse), or null. One check for every way in: the task dialogs (IPC),
 * TaskService.create and the control API.
 */
export function launchOptionsProblem(opts: {
  extraArgs?: string | null;
  addDirs?: readonly string[] | null;
}): string | null {
  if (opts.extraArgs !== undefined) {
    const check = validateExtraArgs(opts.extraArgs);
    if (!check.ok) {
      return `Extra arguments: ${check.error ?? check.blocked.map(flagNoteText).join(' ')}`;
    }
  }
  const folder = (opts.addDirs ?? []).map(addDirProblem).find(Boolean);
  return folder ? `Folders: ${folder}` : null;
}
