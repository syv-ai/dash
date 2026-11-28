import type { IpcResponse, GithubIssue } from '../../shared/types';

/** GitHub issue search and linking (via the `gh` CLI). PRs go through `PrReviewApi`. */
export interface GithubApi {
  githubCheckAvailable: () => Promise<IpcResponse<boolean>>;
  githubSearchIssues: (cwd: string, query: string) => Promise<IpcResponse<GithubIssue[]>>;
  githubGetIssue: (cwd: string, number: number) => Promise<IpcResponse<GithubIssue>>;
  githubPostBranchComment: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
}
