import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { Task } from '../../../shared/types';
import { parseLines, type LineRange, type ShowFileRequest } from '../../../shared/showFile';
import { resolveEditorPath } from '../../services/editorPaths';
import { ControlError, defineCapability, type Registry } from '../registry';
import { assertNotArchived } from './tasks';

export interface ShowCapabilityDeps {
  getTask(id: string): Task | undefined;
  /** The folders besides its worktree a task's editor may open (`editorRoots.ts`). */
  outsideRoots(cwd: string): Promise<string[]>;
  /** Show the file in the task's editor; false when Dash has no window. */
  show(request: ShowFileRequest): boolean;
}

/** Larger than this, the editor won't show a file's text (`editorIpc.ts`). */
const LARGE_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Where a file to show is, as the task's editor names it: repo-relative in
 * its worktree, absolute in one of the outside folders its editor may open
 * (the session's scratchpad, the project's memory). The editor's own rule
 * (`resolveEditorPath`, A10), so `show` opens nothing the person couldn't.
 * Plan files under `~/.claude/plans` are every session's, so they are out.
 */
async function editorPath(
  task: Task,
  filePath: string,
  outsideRoots: (cwd: string) => Promise<string[]>,
  lines: LineRange | null,
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
  if (lines && stat.size <= LARGE_FILE_BYTES) {
    const text = fs.readFileSync(abs, 'utf8');
    const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines.start > count) {
      throw new ControlError(
        400,
        `${filePath} has ${count} lines; --lines starts at ${lines.start}`,
      );
    }
  }
  return plain ? named : path.relative(path.resolve(task.path), named).split(path.sep).join('/');
}

/**
 * Put a file in front of the person, in the task's editor: to explain code
 * (scrolled to and highlighting some lines), or to hand over a plan or a
 * report (Markdown and HTML rendered). It changes nothing on disk, so it never
 * asks permission (`readOnly`).
 */
export function registerShowCapabilities(registry: Registry, deps: ShowCapabilityDeps): void {
  registry.register(
    defineCapability({
      name: 'show',
      summary:
        "Show a file to the person in the task's editor: Markdown and HTML rendered, anything else as code. With --lines, the source scrolled to those lines and highlighting them. The tab is an ordinary one the person can edit; showing the file again reuses it. The file must be in the task's worktree, its scratchpad or its project's memory.",
      input: z.object({
        path: z
          .string()
          .min(1)
          .describe('The file: relative to your working directory, or absolute'),
        lines: z
          .string()
          .refine((v) => parseLines(v) !== null, 'one line (42) or a range (10-20), from 1')
          .optional()
          .describe('A line (42) or a range (10-20) to scroll to and highlight'),
        source: z
          .boolean()
          .optional()
          .describe('A Markdown or HTML file in its source, not rendered'),
        taskId: z
          .string()
          .optional()
          .describe(
            'The task whose editor shows it; an agent inside a task may leave it out for its own',
          ),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['path'], paths: ['path'] },
      // It shows, and changes nothing on disk: an agent never waits on a prompt for it.
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const task = deps.getTask(input.taskId!)!;
        assertNotArchived(task);
        const lines = input.lines ? parseLines(input.lines) : null;
        const shown = await editorPath(task, input.path, deps.outsideRoots, lines);
        const request = { taskId: task.id, path: shown, lines, source: input.source ?? false };
        if (!deps.show(request)) throw new ControlError(409, 'Dash has no window open');
        return { path: shown, ...(lines ? { lines } : {}) };
      },
    }),
  );
}
