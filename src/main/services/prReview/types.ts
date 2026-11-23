import type {
  AzureDevOpsConfig,
  PrReview,
  PrSubmission,
  PullRequest,
  SubmitResult,
} from '@shared/types';

/** Where a PR call runs: the checkout, its project, and (ADO) the credentials. */
export interface PrContext {
  cwd: string;
  projectId: string;
  remote: string | null;
  ado?: AzureDevOpsConfig & { repository: string };
}

/** One provider's PR review operations, behind the shared model. */
export interface PrReviewProvider {
  /** Open PRs, newest first. */
  list(ctx: PrContext): Promise<PullRequest[]>;
  /** The PR's review, with its base and head present in the checkout. */
  load(ctx: PrContext, number: number): Promise<PrReview>;
  setResolved(ctx: PrContext, number: number, threadId: string, resolved: boolean): Promise<void>;
  /** The PR's head commit now: the version of its files a line draft is written on. */
  head(ctx: PrContext, number: number): Promise<string>;
  /** The id of the PR's thread that `ref` names (the thread's own id, or on GitHub
   *  one of its comments' node or REST ids), as a reply is posted to; null if none. */
  replyThread(ctx: PrContext, number: number, ref: string): Promise<string | null>;
  submit(ctx: PrContext, number: number, submission: PrSubmission): Promise<SubmitResult>;
}
