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
  SubmitResult,
  TaskPrs,
} from '../../shared/types';

/** PR review in the diff editor, on the project's provider (GitHub or Azure DevOps). */
export interface PrReviewApi {
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
