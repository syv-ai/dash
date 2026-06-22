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
  githubGetPrForBranch: (
    cwd: string,
    branch: string,
  ) => Promise<IpcResponse<PullRequestInfo | null>>;
  githubListPrs: (cwd: string) => Promise<IpcResponse<PullRequest[]>>;
  githubPreparePrBranch: (
    cwd: string,
    prNumber: number,
    headRefName: string,
  ) => Promise<IpcResponse<{ branch: string; checkedOut: boolean }>>;
}
