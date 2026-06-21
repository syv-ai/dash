import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { GithubService } from '../services/GithubService';
import { GitService } from '../services/GitService';

export function registerGithubIpc(): void {
  ipcMain.handle('github:check-available', async () => {
    try {
      const available = await GithubService.isAvailable();
      return { success: true, data: available };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('github:search-issues', async (_event, args: { cwd: string; query: string }) => {
    try {
      parseArgs(
        'github:search-issues',
        z.looseObject({ cwd: z.string(), query: z.string() }),
        args,
      );
      const issues = await GithubService.searchIssues(args.cwd, args.query);
      return { success: true, data: issues };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('github:get-issue', async (_event, args: { cwd: string; number: number }) => {
    try {
      parseArgs('github:get-issue', z.looseObject({ cwd: z.string(), number: z.number() }), args);
      const issue = await GithubService.getIssue(args.cwd, args.number);
      return { success: true, data: issue };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'github:get-pr-for-branch',
    async (_event, args: { cwd: string; branch: string }) => {
      try {
        parseArgs(
          'github:get-pr-for-branch',
          z.looseObject({ cwd: z.string(), branch: z.string() }),
          args,
        );
        const pr = await GithubService.getPullRequestForBranch(args.cwd, args.branch);
        return { success: true, data: pr };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle('github:list-prs', async (_event, args: { cwd: string }) => {
    try {
      parseArgs('github:list-prs', z.looseObject({ cwd: z.string() }), args);
      const prs = await GithubService.listPullRequests(args.cwd);
      return { success: true, data: prs };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'github:prepare-pr-branch',
    async (_event, args: { cwd: string; prNumber: number; headRefName: string }) => {
      try {
        parseArgs(
          'github:prepare-pr-branch',
          z.looseObject({ cwd: z.string(), prNumber: z.number(), headRefName: z.string() }),
          args,
        );
        const branch = await GithubService.fetchPullRequestHead(
          args.cwd,
          args.prNumber,
          args.headRefName,
        );
        // The head may already be checked out (a prior task on this PR). The
        // modal blocks a worktree-existing checkout on it, same as any branch.
        const checkedOut = (await GitService.getCheckedOutBranches(args.cwd)).has(branch);
        return { success: true, data: { branch, checkedOut } };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle(
    'github:post-branch-comment',
    async (_event, args: { cwd: string; issueNumber: number; branch: string }) => {
      try {
        parseArgs(
          'github:post-branch-comment',
          z.looseObject({ cwd: z.string(), issueNumber: z.number(), branch: z.string() }),
          args,
        );
        await GithubService.postBranchComment(args.cwd, args.issueNumber, args.branch);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle(
    'github:link-branch',
    async (_event, args: { cwd: string; issueNumber: number; branch: string }) => {
      try {
        parseArgs(
          'github:link-branch',
          z.looseObject({ cwd: z.string(), issueNumber: z.number(), branch: z.string() }),
          args,
        );
        await GithubService.linkBranch(args.cwd, args.issueNumber, args.branch);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
