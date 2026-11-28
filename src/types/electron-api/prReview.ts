import type {
  CheckoutVsHead,
  IpcResponse,
  PrProvider,
  PrReactionContent,
  PrRef,
  PrReview,
  PrReviewComment,
  PrReviewSummary,
  PrVerdict,
  PullRequest,
  PullRequestInfo,
  SubmitResult,
  TaskPrs,
} from '../../shared/types';
import type { GeneralReplyTarget } from '../../shared/prGeneralReply';

/** A task's PRs and their review in the diff editor, on the project's provider (GitHub or Azure DevOps). */
export interface PrReviewApi {
  /** The PRs from the branch checked out at `cwd`, newest first, current ones flagged. */
  prForCheckout: (args: {
    projectId: string;
    cwd: string;
    defaultBranch: string;
  }) => Promise<IpcResponse<PullRequestInfo[]>>;
  /** The repo's open PRs, newest first, to start a task on. */
  prListOpen: (args: { projectId: string; cwd: string }) => Promise<IpcResponse<PullRequest[]>>;
  /** Fetch PR `number`'s head into a local branch for a worktree. */
  prPrepareBranch: (args: {
    projectId: string;
    cwd: string;
    number: number;
    headRefName: string;
  }) => Promise<IpcResponse<{ branch: string; checkedOut: boolean }>>;
  /**
   * "Fix CI": write PR `number`'s failed checks to a Markdown file in the
   * checkout at `cwd`; the prompt pointing at it, or null when none failed.
   */
  prWriteCiReport: (args: {
    projectId: string;
    cwd: string;
    number: number;
    url: string;
    headSha?: string;
  }) => Promise<IpcResponse<{ prompt: string; file: string } | null>>;
  /** The open PRs from and into the task's branch (null when the forge
   *  couldn't be asked), and the PR it is in review mode for. */
  prReviewRelevant: (args: { taskId: string }) => Promise<IpcResponse<TaskPrs>>;
  /** PR `number`'s threads and general comments, with its base and head fetched into `cwd`. */
  prReviewLoad: (args: {
    projectId: string;
    cwd: string;
    number: number;
  }) => Promise<IpcResponse<PrReview>>;
  /** Resolve or reactivate a thread on the PR, at once. */
  prReviewSetResolved: (args: {
    projectId: string;
    cwd: string;
    number: number;
    threadId: string;
    resolved: boolean;
  }) => Promise<IpcResponse<void>>;
  /** Give (`on`) or take back the viewer's reaction on a comment of PR `number`, at once. */
  prReviewReact: (args: {
    projectId: string;
    cwd: string;
    number: number;
    commentId: string;
    content: PrReactionContent;
    on: boolean;
  }) => Promise<IpcResponse<void>>;
  /** Submit the task's drafts for PR `number` with a verdict and summary. */
  prReviewSubmit: (args: {
    projectId: string;
    cwd: string;
    taskId: string;
    number: number;
    verdict: PrVerdict;
    body: string;
  }) => Promise<IpcResponse<SubmitResult>>;
  /** Post a reply to a thread of PR `number` at once, outside any review, and
   *  delete draft `draftId` if given. Answers the posted comment. */
  prReviewReply: (args: {
    projectId: string;
    cwd: string;
    taskId: string;
    number: number;
    threadId: string;
    body: string;
    draftId?: string;
  }) => Promise<IpcResponse<PrReviewComment>>;
  /** Reply to general comment `to` of PR `number` at once (a quoting PR
   *  comment on GitHub, a reply in its thread on ADO). Answers the posted comment. */
  prReviewReplyGeneral: (args: {
    projectId: string;
    cwd: string;
    number: number;
    to: GeneralReplyTarget;
    body: string;
  }) => Promise<IpcResponse<PrReviewComment>>;
  /** Where the checkout at `cwd` stands against PR head `head`; null when
   *  `head` isn't in the checkout. */
  prReviewCheckout: (args: {
    cwd: string;
    head: string;
  }) => Promise<IpcResponse<CheckoutVsHead | null>>;
  /** Enter review mode for a PR (null exits it). */
  prReviewSetMode: (args: { taskId: string; pr: PrRef | null }) => Promise<IpcResponse<void>>;
  /** The PR's files the task marked viewed: path → the head blob they were viewed at. */
  prReviewViewed: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
  }) => Promise<IpcResponse<Record<string, string>>>;
  /** Mark a PR file viewed at `blob`; null unmarks it. */
  prReviewSetViewed: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
    path: string;
    blob: string | null;
  }) => Promise<IpcResponse<void>>;
  /** The task's draft summary for PR `number` (its PR-level comment), or null. */
  prReviewGetSummary: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
  }) => Promise<IpcResponse<PrReviewSummary | null>>;
  /** Save the person's draft summary; an empty one clears it. */
  prReviewSetSummary: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
    body: string;
  }) => Promise<IpcResponse<void>>;
  /** Fires when a task's diff comments change outside the editor (agent drafts, a submit). */
  onDiffCommentsChanged: (cb: (data: { taskId: string }) => void) => () => void;
}
