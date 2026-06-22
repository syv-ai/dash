/**
 * Clone/scaffold method registry — pure metadata, no node dependencies, so it's
 * safe to import from both the main process and the renderer bundle. The
 * path-building (`buildSourceCommand`) lives in the main-process module
 * `src/main/services/cloneMethods.ts`, which re-exports everything here.
 */

export type DetectStrategy = 'dest' | 'diff';

export interface CloneMethod {
  id: string;
  label: string;
  /** True when the tool prompts on stdin and must run in a pty the user can type into. */
  interactive: boolean;
}

/** Order matters: index 0 is the default shown in the dropdown. */
export const CLONE_METHODS: readonly CloneMethod[] = [
  { id: 'git', label: 'git', interactive: false },
  { id: 'cookiecutter', label: 'cookiecutter', interactive: true },
  { id: 'copier', label: 'copier', interactive: true },
];

export function getCloneMethod(id: string): CloneMethod | undefined {
  return CLONE_METHODS.find((m) => m.id === id);
}
