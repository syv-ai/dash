import type {
  IpcResponse,
  PrProvider,
  PrReview,
  PrReviewSummary,
  PrVerdict,
  PullRequest,
  SubmitResult,
} from '../../shared/types';

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
  /** Whether the task is reviewing PR `number` (Review clicked, not yet submitted). */
  prReviewInReview: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
  }) => Promise<IpcResponse<boolean>>;
  /** Start or end the task's review of PR `number`. */
  prReviewSetInReview: (args: {
    taskId: string;
    provider: PrProvider;
    number: number;
    on: boolean;
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
