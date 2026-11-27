import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { Task } from '../../../shared/types';
import { resolveEditorPath } from '../../services/editorPaths';
import { ControlError, defineCapability, type Registry } from '../registry';
import { assertNotArchived } from './tasks';

export interface PresentCapabilityDeps {
  getTask(id: string): Task | undefined;
  /** The folders besides its worktree a task's editor may open (`editorRoots.ts`). */
  outsideRoots(cwd: string): Promise<string[]>;
  /** Show the file in the task's editor (`path` as the editor names it);
   *  false when Dash has no window. */
  present(task: Task, path: string): boolean;
}

/**
 * Where a presented file is, as the task's editor names it: repo-relative in
 * its worktree, absolute in one of the outside folders its editor may open
 * (the session's scratchpad, the project's memory). The editor's own rule
 * (`resolveEditorPath`, A10), so `present` opens nothing the person couldn't.
 * Plan files under `~/.claude/plans` are every session's, so they are out.
 */
async function presentedPath(
  task: Task,
  filePath: string,
  outsideRoots: (cwd: string) => Promise<string[]>,
): Promise<string> {
  const named = path.resolve(task.path, filePath);
  const outside = await outsideRoots(task.path);
  let abs: string;
  let plain: boolean;
  try {
    ({ abs, plain } = resolveEditorPath(task.path, named, outside, 'read'));
  } catch {
    throw new ControlError(
      403,
      `${filePath} is outside the task's worktree, its scratchpad and its project's memory`,
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ControlError(404, `no file at ${filePath}`);
  }
  if (!stat.isFile()) throw new ControlError(400, `${filePath} is not a file`);
  return plain ? named : path.relative(path.resolve(task.path), named).split(path.sep).join('/');
}

/**
 * Put a file in front of the person: a rendered, read-only tab in the task's
 * editor (Markdown and HTML rendered, any other file as code).
 */
export function registerPresentCapabilities(registry: Registry, deps: PresentCapabilityDeps): void {
  registry.register(
    defineCapability({
      name: 'present',
      summary:
        "Show a file to the person in the task's editor: a read-only tab, Markdown and HTML rendered (with a toggle to the source), other files as code. Presenting again reuses the tab and reloads it; it follows the file as it changes. The file must be in the task's worktree, its scratchpad or its project's memory.",
      input: z.object({
        path: z
          .string()
          .min(1)
          .describe('The file: relative to your working directory, or absolute'),
        taskId: z
          .string()
          .optional()
          .describe(
            'The task whose editor shows it; an agent inside a task may leave it out for its own',
          ),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['path'], paths: ['path'] },
      // It only changes what the person sees, but it does change it (as tasks.open).
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const task = deps.getTask(input.taskId!)!;
        assertNotArchived(task);
        const shown = await presentedPath(task, input.path, deps.outsideRoots);
        if (!deps.present(task, shown)) throw new ControlError(409, 'Dash has no window open');
        return { path: shown };
      },
    }),
  );
}
