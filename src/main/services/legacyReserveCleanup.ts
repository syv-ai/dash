import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { worktreeService } from './WorktreeService';

const execFileAsync = promisify(execFile);

/**
 * Dash before 0.17 kept a pre-made "reserve" worktree per project
 * (`_reserve-<hash>` on branch `_reserve/<hash>`). The pool is gone; this
 * removes what it left in each known project. None of it holds work.
 */
export async function removeLegacyReserves(projectPaths: string[]): Promise<void> {
  for (const projectPath of projectPaths) {
    // The current dir and the pre-0.16 sibling dir.
    const worktreeDirs = [
      worktreeService.getWorktreesDir(projectPath),
      worktreeService.getLegacyWorktreesDir(projectPath),
    ].filter((dir) => fs.existsSync(dir));
    for (const dir of worktreeDirs) {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith('_reserve-')) continue;
        const reservePath = path.join(dir, entry);
        try {
          await execFileAsync('git', ['worktree', 'remove', '--force', reservePath], {
            cwd: projectPath,
          });
        } catch {
          fs.rmSync(reservePath, { recursive: true, force: true });
        }
      }
    }
    if (!fs.existsSync(projectPath)) continue;

    try {
      // Drop records of worktrees whose directory is gone first: git refuses
      // to delete a branch it still believes a worktree holds.
      await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });
      const { stdout } = await execFileAsync(
        'git',
        ['branch', '--list', '--format=%(refname:short)', '_reserve/*'],
        { cwd: projectPath },
      );
      for (const branch of stdout.split('\n').map((b) => b.trim())) {
        if (!branch) continue;
        await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath }).catch(() => {});
      }
    } catch {
      // Not a git repo, or git failed: nothing to clean here.
    }
  }
}
