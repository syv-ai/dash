import { flagName, validateExtraArgs } from './extraArgs';

/**
 * The folders a task's extra arguments load as plugins (`--plugin-dir <dir>`,
 * repeatable, or `--plugin-dir=<dir>`), as typed. Empty when the line can't
 * be passed: a refused line loads nothing.
 */
export function pluginDirsOf(extraArgs: string | null | undefined): string[] {
  const { ok, args } = validateExtraArgs(extraArgs);
  if (!ok) return [];
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    if (flagName(word) !== '--plugin-dir') continue;
    const eq = word.indexOf('=');
    const value = eq >= 0 ? word.slice(eq + 1) : args[i + 1];
    if (eq < 0) i++;
    if (value && flagName(value) === null) dirs.push(value);
  }
  return dirs;
}
