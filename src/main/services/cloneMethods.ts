import { join } from 'path';

export type DetectStrategy = 'dest' | 'diff';

export interface CloneMethod {
  id: string;
  label: string;
  /** True when the tool prompts on stdin and must run in a pty the user can type into. */
  interactive: boolean;
}

export interface SourceCommandContext {
  url: string;
  parentDir: string;
  /** Derived repo/project name; used for `dest`-based methods, ignored for `diff`. */
  name: string;
}

export interface SourceCommand {
  command: string[];
  cwd: string;
  detect: DetectStrategy;
  /** The known result folder for `detect: 'dest'`; null for `diff`. */
  dest: string | null;
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

export function buildSourceCommand(methodId: string, ctx: SourceCommandContext): SourceCommand {
  const dest = join(ctx.parentDir, ctx.name);
  switch (methodId) {
    case 'git':
      return { command: ['git', 'clone', ctx.url, dest], cwd: ctx.parentDir, detect: 'dest', dest };
    case 'copier':
      return {
        command: ['copier', 'copy', ctx.url, dest],
        cwd: ctx.parentDir,
        detect: 'dest',
        dest,
      };
    case 'cookiecutter':
      return {
        command: ['cookiecutter', ctx.url],
        cwd: ctx.parentDir,
        detect: 'diff',
        dest: null,
      };
    default:
      throw new Error(`Unknown clone method: ${methodId}`);
  }
}
