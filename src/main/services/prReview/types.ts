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
  submit(ctx: PrContext, number: number, submission: PrSubmission): Promise<SubmitResult>;
}
