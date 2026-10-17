import type { IpcResponse, GithubIssue, PullRequest, PullRequestInfo } from '../../shared/types';

/** GitHub issue search/linking and PR lookup (via the `gh` CLI). */
export interface GithubApi {
  githubCheckAvailable: () => Promise<IpcResponse<boolean>>;
  githubSearchIssues: (cwd: string, query: string) => Promise<IpcResponse<GithubIssue[]>>;
  githubGetIssue: (cwd: string, number: number) => Promise<IpcResponse<GithubIssue>>;
  githubPostBranchComment: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  githubLinkBranch: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  /** The PRs worth showing for the branch checked out at `cwd`, newest first. */
  githubGetPrsForCheckout: (
    cwd: string,
    defaultBranch: string,
  ) => Promise<IpcResponse<PullRequestInfo[]>>;
  githubListPrs: (cwd: string) => Promise<IpcResponse<PullRequest[]>>;
  githubPreparePrBranch: (
    cwd: string,
    prNumber: number,
    headRefName: string,
  ) => Promise<IpcResponse<{ branch: string; checkedOut: boolean }>>;
}
