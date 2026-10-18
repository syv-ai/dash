import type { IpcResponse, PrProvider, PrReview, PullRequest } from '../../shared/types';

/** PR review in the diff editor, on the project's provider (GitHub or Azure DevOps). */
export interface PrReviewApi {
  /** The project's open PRs, and which provider they're on. */
  prReviewList: (args: {
    projectId: string;
    cwd: string;
  }) => Promise<IpcResponse<{ provider: PrProvider; prs: PullRequest[] }>>;
  /** PR `number`'s threads and general comments, with its base and head fetched into `cwd`. */
  prReviewLoad: (args: {
    projectId: string;
    cwd: string;
    number: number;
  }) => Promise<IpcResponse<PrReview>>;
}
