import type {
  AzureDevOpsConfig,
  PrReview,
  PrReviewComment,
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

/** The part of a PrReview local git provides, the same on every forge (see `loadPrReview`). */
export type LocalPrFields = 'files' | 'commits' | 'behindBase';

/** What a provider knows of a PR's review: everything but the local-git part. */
export type ForgeReview = Omit<PrReview, LocalPrFields>;

/** A provider's load: its review, and the base branch's tip now (present in
 *  the checkout), which local git counts how far behind head is against; null
 *  when the forge doesn't say. */
export type ForgeLoad = ForgeReview & { baseTip: string | null };

/** One provider's PR review operations, behind the shared model. */
export interface PrReviewProvider {
  /** Open PRs, newest first. */
  list(ctx: PrContext): Promise<PullRequest[]>;
  /** The PR's review, with its base, head and base tip present in the checkout. */
  load(ctx: PrContext, number: number): Promise<ForgeLoad>;
  setResolved(ctx: PrContext, number: number, threadId: string, resolved: boolean): Promise<void>;
  submit(ctx: PrContext, number: number, submission: PrSubmission): Promise<SubmitResult>;
  /** Post a reply to a thread at once, outside any review. */
  reply(ctx: PrContext, number: number, threadId: string, body: string): Promise<PrReviewComment>;
}
