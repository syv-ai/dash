import type {
  AzureDevOpsConfig,
  ForgeCapabilities,
  PrDetails,
  PrGitField,
  PrReview,
  PullRequest,
  PullRequestInfo,
  PrReviewComment,
  PrListFilter,
  PrReactionContent,
  PrSubmission,
  RelevantPr,
  SubmitResult,
} from '@shared/types';
import type { GeneralReplyTarget } from '@shared/prGeneralReply';
import type { FailedCheck } from '../ciReport';

/** Where a PR call runs: the checkout, its project, and (ADO) the credentials. */
export interface PrContext {
  cwd: string;
  projectId: string;
  remote: string | null;
  ado?: AzureDevOpsConfig & { repository: string };
}

/** The part of a PrReview local git provides the same way on every forge
 *  (see `loadPrReview`); the merge-base is the provider's to find. */
export type LocalPrFields = Exclude<PrGitField, 'base'>;

/** What a provider knows of a PR's review: everything but the local-git part
 *  and its forge's capabilities, which `loadPrReview` adds. */
export type ForgeReview = Omit<PrReview, LocalPrFields | 'capabilities'>;

/** What a provider tells of a PR without git: its details but for its
 *  forge's capabilities, which `loadPrDetails` adds. */
export type ForgeDetails = Omit<PrDetails, 'capabilities'>;

/** A provider's load: its review, and the base branch's tip now (present in
 *  the checkout), which local git counts how far behind head is against; null
 *  when the forge doesn't say. */
export type ForgeLoad = ForgeReview & { baseTip: string | null };

/** One forge's PR operations, behind the shared model: everything Dash asks
 *  of a forge goes through here, so no caller names the forge. */
export interface ForgeProvider {
  /** What it offers beyond the shared model; stamped on each review it loads. */
  capabilities: ForgeCapabilities;
  /** Every PR from `branch`, in any state, with CI on the open ones (see
   *  `prsForCheckout`, which reads the branch and flags the current ones). */
  prsFrom(ctx: PrContext, branch: string): Promise<PullRequestInfo[]>;
  /** The repo's open PRs, newest first, to start a task on (the new-task PR list). */
  listOpen(ctx: PrContext): Promise<PullRequest[]>;
  /** Fetch PR `pr`'s head into a local branch for a worktree; answers the branch's name. */
  prepareBranch(ctx: PrContext, pr: Pick<PullRequest, 'number' | 'headRefName'>): Promise<string>;
  /** The PR's failed checks, each with what the forge tells of it (steps,
   *  annotations, the log up to the failure); a detail it can't read becomes a notice. */
  failedChecks(ctx: PrContext, number: number): Promise<FailedCheck[]>;
  /** The forge profile of commit `sha`'s author in the checkout at `cwd`, as
   *  the forge matched it; null where it matches none (or can't). */
  commitAuthorUrl(cwd: string, sha: string): Promise<string | null>;
  /** Open PRs, newest first; only those from or into a branch with `filter`. */
  list(ctx: PrContext, filter?: PrListFilter): Promise<RelevantPr[]>;
  /** The PR's review as the forge tells it, with no git call (see `PrDetails`). */
  details(ctx: PrContext, number: number): Promise<ForgeDetails>;
  /** The PR's details and what git adds to them, with its base, head and
   *  base tip present in the checkout. */
  load(ctx: PrContext, number: number): Promise<ForgeLoad>;
  setResolved(ctx: PrContext, number: number, threadId: string, resolved: boolean): Promise<void>;
  submit(ctx: PrContext, number: number, submission: PrSubmission): Promise<SubmitResult>;
  /** Post a reply to a thread at once, outside any review. */
  reply(ctx: PrContext, number: number, threadId: string, body: string): Promise<PrReviewComment>;
  /** Post a reply to general comment `to` (the PR's conversation) at once:
   *  a quoting PR comment on GitHub, a reply in its thread on ADO. */
  replyGeneral(
    ctx: PrContext,
    number: number,
    to: GeneralReplyTarget,
    body: string,
  ): Promise<PrReviewComment>;
  /** Give (`on`) or take back the viewer's reaction on comment `commentId`, at once. */
  react(
    ctx: PrContext,
    number: number,
    commentId: string,
    content: PrReactionContent,
    on: boolean,
  ): Promise<void>;
}
