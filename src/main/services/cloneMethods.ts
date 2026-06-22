import { join } from 'path';
import {
  CLONE_METHODS,
  getCloneMethod,
  type CloneMethod,
  type DetectStrategy,
} from '@shared/cloneMethods';

// Re-export the shared registry so existing main-process imports keep working.
export { CLONE_METHODS, getCloneMethod };
export type { CloneMethod, DetectStrategy };

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
