import type {
  IpcResponse,
  PrProvider,
  PrRef,
  PrReview,
  PrReviewComment,
  PrReviewSummary,
  PrVerdict,
  PullRequest,
  RelevantPrs,
  SubmitResult,
  TaskReviewTarget,
} from '../../shared/types';

/** PR review in the diff editor, on the project's provider (GitHub or Azure DevOps). */
export interface PrReviewApi {
  /** The project's open PRs, and which provider they're on. */
  prReviewList: (args: {
    projectId: string;
    cwd: string;
  }) => Promise<IpcResponse<{ provider: PrProvider; prs: PullRequest[] }>>;
  /** The open PRs from and into the task's branch, newest first. */
  prReviewRelevant: (args: { taskId: string }) => Promise<IpcResponse<RelevantPrs>>;
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
  /** How many commits HEAD at `cwd` has that PR head `head` lacks (local
   *  commits not pushed to the PR yet); null when `head` isn't in the checkout. */
  prReviewLocalAhead: (args: { cwd: string; head: string }) => Promise<IpcResponse<number | null>>;
  /** The PR the task reviews and why (picked, or its own open PR), or null. */
  prReviewTarget: (args: { taskId: string }) => Promise<IpcResponse<TaskReviewTarget | null>>;
  /** Pick the PR the task reviews (null stops reviewing); answers the target now. */
  prReviewSetTarget: (args: {
    taskId: string;
    target: PrRef | null;
  }) => Promise<IpcResponse<TaskReviewTarget | null>>;
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
