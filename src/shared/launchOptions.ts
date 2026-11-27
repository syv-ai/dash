import { addDirProblem } from './addDirs';
import { flagNoteText, validateExtraArgs } from './extraArgs';
import { envProblems } from './taskEnv';

/**
 * Why a task's launch options can't be saved (the flags a dispatch would then
 * refuse), or null. One check for every way in: the task dialogs (IPC),
 * TaskService.create and the control API.
 */
export function launchOptionsProblem(opts: {
  extraArgs?: string | null;
  addDirs?: readonly string[] | null;
  /** Checked as a person sets it; the control API adds a task caller's rules. */
  env?: Readonly<Record<string, string>> | null;
}): string | null {
  if (opts.extraArgs !== undefined) {
    const check = validateExtraArgs(opts.extraArgs);
    if (!check.ok) {
      return `Extra arguments: ${check.error ?? check.blocked.map(flagNoteText).join(' ')}`;
    }
  }
  const folder = (opts.addDirs ?? []).map(addDirProblem).find(Boolean);
  if (folder) return `Folders: ${folder}`;
  const env = envProblems(opts.env ?? {}, 'person');
  return env.length > 0 ? `Environment: ${env.map((e) => e.problem).join(' ')}` : null;
}
