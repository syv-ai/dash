# Unified PR reviewer in the diff editor (GitHub + Azure DevOps)

Status: design agreed 2026-10-19. Builds on `2f05454` (read-only GitHub PR view, unresolved threads only). Refs #204, #193.

## Goal

A reviewer does a whole PR review in Dash's diff editor, for GitHub and Azure DevOps PRs. That covers four things:

- reading the diff and every thread;
- writing inline comments;
- replying to threads and resolving them;
- submitting with a verdict.

A task with Dash access can create, read, update and delete _draft_ comments in that view. The human edits them and submits.

## Decisions

| Topic            | Decision                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build order      | GitHub end-to-end first (read → write → agent tools), behind a provider interface. The ADO adapter follows as its own phase.                                                                                     |
| Draft owner      | The task the diff editor is opened from. Drafts are rows in `diff_editor_comments` under that `taskId`. They survive archiving (restore brings them back) and go when the task is deleted (`ON DELETE CASCADE`). |
| Draft storage    | Extend `diff_editor_comments` (no sibling table, and no GitHub-side pending review used as storage).                                                                                                             |
| Submit model     | New comments and replies stay local drafts until Submit. Resolve and reactivate go out immediately.                                                                                                              |
| Auth             | No new auth flow. A missing write scope fails the submit, keeps the drafts, and shows the exact fix.                                                                                                             |
| Left side        | New comments only on the right (PR head) side in v1. Existing LEFT threads are shown and can be replied to.                                                                                                      |
| Agent reach      | The agent lists all drafts but updates or deletes only drafts it wrote. A human edit makes a draft the human's.                                                                                                  |
| Agent target     | Explicit `{ provider?, number }`. The provider is inferred from the project's remote.                                                                                                                            |
| PR picker        | The header's "Compare with branch…" becomes "Compare…", with Branches and Pull requests tabs.                                                                                                                    |
| Review panel     | The PR view's corner menu grows into a "Review · n drafts" popover. It holds the Conversation, off-code threads and the Submit footer.                                                                           |
| Resolved threads | Render as a collapsed one-line pill under their line. Clicking one expands it, with Reactivate.                                                                                                                  |

## Notes and comments (revised 2026-10-19, after the first live try)

Every line comment in a PR view used to be a PR draft, so there was no way left to hand a thought to the agent. Now there are two kinds:

- A **note** is local and for the agent, as comments were before PR review existed. It never reaches the PR.
- A **comment** is a PR review comment: a draft until Submit posts it.

How the kinds come about:

- A **Review** button sits beside the PR view's corner widget, in every PR view. It stands out when you're a requested reviewer who hasn't reviewed yet (`PrReview.viewerIsRequestedReviewer`: GitHub's `reviewRequests` against `viewer.login`; on ADO, your id in `reviewers[]` with no vote).
- Until Review is clicked, what you write is a note. After, it's a comment. Notes written before stay notes; a note's **promote** button (on its bubble and in the widget) makes it a comment.
- Being in review is kept per task and PR in `pr_reviews_in_progress`, so it survives restarts. A submit that all got through ends it (main, in `prReview:submit`), and writing goes back to notes. Clicking "In review" also ends it.
- Thread replies are comments, so Reply shows only in review.
- Notes and comments can each be sent to the agent, one or all at once. Sending marks them sent (muted), but a sent comment is still submitted, and "Clear sent" never deletes a comment. "Clear notes" (in the widget's Notes section and the Submit footer) deletes the PR's notes before submitting.
- The agent writes either kind: `review_drafts_create` takes a required `kind`, and `review_drafts_update` can change it.

Storage: `diff_editor_comments.kind` (`'note' | 'comment'`, default `'note'`; the migration makes existing `pr:*` rows comments). Both kinds keep the scope `pr:<provider>:<n>`; only a PR scope can hold a comment. Submit reads comments only (`listPrDrafts`).

The corner widget is one popover (`PrReviewMenu`, built from `CommentsMenu`'s sections and file rows): your comments and your notes per file (navigate, send, promote, clear), unresolved threads, threads off the code, the conversation, and the Submit footer. The verdict is a `ui/Select` dropdown. Nothing in it scrolls sideways; long text wraps. The task's comments menu outside a PR view lists notes, PR notes included, but no PR comments.

The file tree shows two badges per file in a PR view: your notes and comments (filled), and the PR's unresolved threads (outlined).

Where this section and the rest of the spec disagree, this section wins.

## Out of scope (v1)

- Starting a thread on a removed (LEFT) line.
- Replying to general PR comments. Your own general comment is the submit summary.
- Suggested-change blocks, reactions, editing or deleting comments that are already posted, file-level (no-line) comments, and multiple pending reviews.
- Any agent tool that submits, resolves or touches the remote PR. Those stay human-only in the UI (#193).
- New auth flows.

## Model (`src/shared/types.ts`)

Replace today's GitHub-only, unresolved-only types with provider-neutral ones:

```ts
export type PrProvider = 'github' | 'ado';

export type PrVerdict =
  | 'comment'
  | 'approve'
  | 'request_changes' // GitHub
  | 'approve_with_suggestions'
  | 'wait_for_author'
  | 'reject'; // + ADO (ADO also has approve / comment)

export interface PrReviewComment {
  id;
  author;
  body;
  createdAt;
  url;
} // unchanged

export interface PrReviewThread {
  id: string;
  path: string;
  line: number | null; // last line, in the PR head (RIGHT) or base (LEFT); null when outdated
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  isOutdated: boolean;
  resolved: boolean; // new: all threads are loaded, not just unresolved ones
  comments: PrReviewComment[];
}

export interface PrReview {
  provider: PrProvider; // new
  number: number;
  title: string; // new
  url: string;
  viewerIsAuthor: boolean; // new: GitHub refuses approve/request changes on your own PR
  verdicts: PrVerdict[]; // new: what this provider offers, in display order
  base: string; // merge-base sha
  head: string; // head sha
  threads: PrReviewThread[]; // file threads, all states
  conversation: PrReviewComment[]; // new: general comments and review summaries, oldest first
}
```

`EditorView` kind `pr` gains a `provider`: `{ kind: 'pr'; provider; number; base; head }`. `commentScope` becomes `pr:<provider>:<n>`. No rows use the old `pr:<n>` scope today (the PR view turns local comments off), so no data migration is needed. PR views aren't restored from storage (`parseStoredView`), so no back-compat is needed.

## Main: provider adapters (`src/main/services/prReview/`)

`prReview.ts` becomes a folder. Each adapter is a pure mapper (unit-tested with fixtures, as `prReview.test.ts` is today) plus a thin I/O layer.

```ts
interface PrReviewProvider {
  list(cwd): Promise<PullRequest[]>; // existing GithubService/AzureDevOpsService.listPullRequests
  load(cwd, number): Promise<PrReview>; // also fetches base/head locally if missing
  setResolved(cwd, number, threadId, resolved): Promise<void>;
  submit(cwd, number, s: PrSubmission): Promise<SubmitResult>;
}
interface PrSubmission {
  verdict: PrVerdict;
  body: string;
  comments: { draftId; path; startLine; endLine; body }[]; // RIGHT side
  replies: { draftId; threadId; body }[];
}
interface SubmitResult {
  postedDraftIds: string[];
  error?: PrWriteError;
}
type PrWriteError =
  | { kind: 'scope'; fix: string }
  | { kind: 'pending-review' }
  | { kind: 'other'; message: string };
```

`providerFor(remote)` picks the adapter with `isAdoRemote` / `githubSlug` from `src/shared/urls.ts`.

### GitHub (`gh api graphql`)

- **Load:** extend `PR_REVIEW_QUERY` with `title`, `viewerDidAuthor`, every review thread (with `isResolved`), `comments` (issue comments) and `reviews { body state author }` (non-empty bodies only).
  - `conversation` is the issue comments plus the review bodies, ordered by `createdAt`.
  - Pagination stays at the current `first: 100` threads and `first: 50` comments. When `pageInfo.hasNextPage`, the corner menu shows a "partial" note.
- **Head fetch:** as today (fetch `baseRefOid` and `headRefOid` when `merge-base` misses).
- **Resolve:** the `resolveReviewThread` and `unresolveReviewThread` mutations.
- **Submit, all or nothing:**
  1. `addPullRequestReview` (no `event`) with `threads: [{ path, line: endLine, startLine (if ≠ endLine), side: RIGHT, body }]`.
  2. One `addPullRequestReviewThreadReply { pullRequestReviewId, pullRequestReviewThreadId, body }` per reply.
  3. `submitPullRequestReview { event, body }`.
  - On any failure after step 1, call `deletePullRequestReview` and return an error with `postedDraftIds: []`.
  - An existing pending review of the viewer's (from the web) makes step 1 fail. Report it as `pending-review` ("You have a pending review on GitHub; submit or discard it there").
- **Verdicts:** `comment`, `approve`, `request_changes`. When `viewerIsAuthor`, only `comment`.
- **Scope errors:** `gh` stderr naming a missing scope or `Resource not accessible` maps to `{ kind: 'scope', fix: 'gh auth refresh -s repo' }`.

### Azure DevOps (REST, `AzureDevOpsService.request`)

Verified on 2026-10-19 against a real PR (Akademikernes / aka-ai-platform, PR 7204: 11 iterations, 15 file threads), with read-only calls only. Marked _(docs)_ where only the docs back a point.

- **Iterations:** `GET …/pullRequests/{id}/iterations`; N is the highest `id`.
  - The latest iteration's `sourceRefCommit.commitId` is the **head**, and its `commonRefCommit.commitId` is the **base**.
  - `commonRefCommit` is the base of the web "Files" diff, and it equalled `git merge-base` in the check. ADO's own base is used, not a computed one.
- **Threads:** `GET …/pullRequests/{id}/threads?$iteration=N&$baseIteration=0` returns one page, no pagination.
  - **Verified:** with both parameters, ADO moves every thread's `threadContext` onto the common..N diff. A thread left on iteration 9 at lines 96–108 comes back at 108–120, and the file content matches there.
  - With `$iteration` alone, nothing moves.
  - A thread that was moved carries `pullRequestThreadContext.trackingCriteria` (with `orig*` positions). One without it simply didn't need moving: its file or lines were unchanged since. So **a missing `trackingCriteria` doesn't mean outdated**.
  - ADO has no outdated flag. Dash marks an ADO thread outdated (`line: null`) when its file no longer exists at head (checked with one `git ls-tree` of head). A range whose code was edited comes back widened to cover the edit (106–110 → 107–116), which is fine to draw.
  - Thread `id` is numeric, so we use `String(id)`. Comment ids restart at 1 in each thread, so a comment's id is `${threadId}:${commentId}`. `parentCommentId` is 0 for the first comment and 1 for replies.
  - Comment fields: `author.displayName`, `content` (Markdown), `publishedDate`, `commentType` (`text` | `system`), `isDeleted`.
- **System threads:** they carry `properties.CodeReviewThreadType`, for example `RefUpdate`, `ReviewersUpdate`, `VoteUpdate`, `PolicyStatusUpdate` and `StatusUpdate`. Their comments have `commentType: 'system'`, and their `status` is null.
  - A vote thread's author is the human voter, so filter on type, not author.
  - Filter: keep a thread when `!isDeleted && !properties?.CodeReviewThreadType && comments.some(c => c.commentType !== 'system' && !c.isDeleted)`. Drop deleted comments inside kept threads.
- **Mapping:**
  - A thread with a `threadContext` is a file thread. Its `filePath` has a leading `/`, which is stripped. `rightFileStart/End.line` gives RIGHT and `leftFileStart/End.line` gives LEFT. A context with neither is a file-level thread (`line: null`, not outdated).
  - `resolved` is `status ∉ {active, pending}`, so `fixed`, `wontFix`, `closed` and `byDesign` all count as resolved.
  - A thread without a `threadContext` is general, and its comments go to `conversation`, read-only in v1.
  - The URL is `{org}/{project}/_git/{repo}/pullrequest/{id}?_a=files&discussionId={threadId}` (a community convention).
- **Who you are:** `GET {org}/_apis/connectionData` → `authenticatedUser.id`. **It needs `api-version=7.1-preview`; plain `7.1` returns 400.**
  - This id matched the user's id in `…/reviewers`.
  - `viewerIsAuthor` is `pr.createdBy.id === me`. ADO lets authors vote, so every verdict is offered.
- **Head fetch:** both are verified on Azure Repos over SSH, in a throwaway repo:
  - `git fetch origin <sha>` works, even for an old iteration's commit;
  - `refs/pull/{id}/merge` exists only while the PR is active.
  - So the same "fetch the missing commits by sha" path as GitHub is used, with base and head.
- **Resolve:** `PATCH threads/{tid} { status: 'fixed' }`; reactivate is `{ status: 'active' }`. _(docs)_
- **Submit:** sequential, and not atomic.
  1. Fetch N and `…/iterations/N/changes?$top=2000` (follow `nextSkip`). Map `item.path` → `changeTrackingId` (verified, as in `{ changeTrackingId: 1, changeType: 'edit', item.path: '/backend/…' }`).
  2. **Each comment:** `POST threads` with:
     ```json
     { "comments": [{ "parentCommentId": 0, "content": "…", "commentType": 1 }], "status": 1,
       "threadContext": { "filePath": "/src/a.ts",
         "rightFileStart": { "line": 10, "offset": 1 },
         "rightFileEnd":   { "line": 14, "offset": <length of line 14 + 1> } },
       "pullRequestThreadContext": { "changeTrackingId": 7,
         "iterationContext": { "firstComparingIteration": N, "secondComparingIteration": N } } }
     ```
     - The end offset is the last line's length plus 1 (verified: end offsets in real threads match this). The line text is read from the head commit (`git show head:path`).
     - `{N, N}` matches what existing threads carry (common..N).
     - `pullRequestThreadContext` is left out when the path has no change entry (the file isn't in the PR's diff).
  3. **Each reply:** `POST threads/{tid}/comments { content, parentCommentId: 1, commentType: 1 }`. _(docs)_
  4. **The vote:** `PUT reviewers/{me} { vote }`. It adds you as a reviewer if you aren't one. _(docs)_ Values: approve 10, approve_with_suggestions 5, wait_for_author -5, reject -10. `comment` makes no vote call. It goes before the summary: a vote is safe to repeat and a summary isn't, so a retry after a failure repeats nothing harmful.
  5. **A non-empty summary:** a general thread (no `threadContext`) with `status: 4` (closed). A summary isn't a request to act on, and an `active` thread would hold up repos that require comment resolution. Inline comments stay `active`.
  - Each successful post adds its `draftId` to `postedDraftIds`. The first failure stops the run and returns the error with what posted so far, so a retry doesn't duplicate.
- **Errors:** `request()` sends `X-TFS-FedAuthRedirect: Suppress` (so bad auth is a 401, not a 203 sign-in page) and throws an `AdoRequestError` carrying `status`. A 401 or 403 on a write maps to `{ kind: 'scope', fix: 'Give the PAT "Code (Read & write)" in Azure DevOps → User settings → Personal access tokens' }`.

### IPC (`src/main/ipc/prReviewIpc.ts`, moved out of `githubIpc.ts`)

Every call carries `{ projectId, cwd }`. Main resolves the provider and credentials from the project's remote (`prContextFor`), so the renderer never names the provider.

- `prReview:list` returns `{ provider, prs }`, the open PRs.
- `prReview:load { number }` returns `PrReview`.
- `prReview:setResolved { number, threadId, resolved }`.
- `prReview:submit { taskId, number, verdict, body }`:
  1. Main reads the task's drafts for scope `pr:<provider>:<n>` from `diff_editor_comments`; the renderer doesn't send them.
  2. It calls `submit`.
  3. It deletes the rows in `postedDraftIds`.
  4. It emits `diffComments:changed`.
  5. It returns `SubmitResult`.

## Drafts: `diff_editor_comments`

A migration adds three columns:

- `side TEXT NOT NULL DEFAULT 'RIGHT'`: always RIGHT in v1, but stored so LEFT can come later without a migration.
- `reply_to TEXT NULL`: the remote thread id for a reply draft. For reply rows, `start_line` and `end_line` copy the thread's anchor, so they sort and place next to the thread.
- `author TEXT NOT NULL DEFAULT 'user'`: `'user' | 'agent'`. Any upsert from the renderer sets `'user'`.

`DiffComment` and `DiffCommentInput` gain `side`, `replyTo` and `author`. The `sent` flag keeps its meaning ("sent to the task"). PR drafts never set it, and submitting deletes them.

Main gets a small `diffCommentEvents` emitter (modelled on `taskEvents`) that broadcasts `diffComments:changed { taskId }`. It fires on writes from the control API and from submit. `commentsStore` reloads when it is the loaded task's id. Renderer writes don't emit, since the store already holds them.

`diffComments:pruneForTask` must skip `pr:*` scopes, because a PR's files needn't exist in the task's worktree.

## Renderer

- **`EditorHeader` + `BranchPicker`:** "Compare…" opens a popover with Branches and Pull requests tabs.
  - A new `PrPicker` (same shell as `BranchPicker`: search plus rows `#n title @author`) calls `prReview:list`.
  - Picking a PR calls `usePrReviews.load(…)`, then `changeView({ kind: 'pr', … })`.
  - In a PR view the header reads `PR #n: title`.
  - The commits-drawer "PR #n" row for the task's own PR stays as a shortcut.
- **`prReviewStore`:** keyed by `${provider}:${number}` instead of by task. The #204 new-comment polling keeps its per-task key and reads unresolved threads from the new `threads`.
- **Inline threads (`PrThreadOverlay` / `PrThreadCard`):**
  - Unresolved threads render open. Resolved ones render as a pill: `✓ Resolved · @author · n comments`. It expands on click.
  - Each card has a reply box. Saving a reply creates a draft row with `replyTo`. Reply drafts render _inside_ the thread card, not as `CommentOverlay` bubbles: the card and the bubbles each own Monaco view zones, and two zones under the same line would stack. `useFileComments` skips reply rows (`isReplyDraft`).
  - Resolve and Reactivate call `prReview:setResolved`, update the store optimistically, and revert with a toast on error.
- **New comments:** turn on the existing gutter-selection and comment flow in the PR view (drop the `!isPrView` gates in `EditorPane`). Rows are written with scope `pr:<provider>:<n>`. Agent drafts get a small "agent" tag in the bubble.
- **`PrReviewMenu` becomes the review panel:** the trigger reads `Review · n drafts`, or `n unresolved` when there are no drafts. The popover holds:
  - header: `PR #n` and "Send all to task" (kept);
  - Conversation (read-only);
  - "Not on the current code" (repliable and resolvable);
  - Submit footer: a verdict `Segmented` from `review.verdicts` (default `comment`), a summary textarea, and `Submit (n comments)`.
  - Submit disables while in flight.
  - On `scope` errors it shows the fix inline with a copy button. On `pending-review` it shows the message. Drafts that didn't post stay.
  - On success it reloads the review and toasts "Review submitted".
- **UI primitives:** `ui/Popover` and `ui/Button`. `ui/Segmented` serves both the Branches / Pull requests tabs and the verdict picker. No new primitives. Tailwind tokens only.

## Agent tools (`src/main/control/capabilities/review.ts`)

| Capability             | readOnly | Input                                                                             | Behaviour                                                                                                                |
| ---------------------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `review.drafts_list`   | yes      | `{ taskId?, provider?, number }`                                                  | The target task's notes and comments for that PR: `{ id, path, startLine, endLine, side, replyTo, kind, body, author }`. |
| `review.drafts_create` | no       | `{ taskId?, provider?, number, path, startLine, endLine?, body, kind, replyTo? }` | Inserts an `author: 'agent'` row of that `kind`. Validates `startLine ≤ endLine`.                                        |
| `review.drafts_update` | no       | `{ taskId?, id, body?, startLine?, endLine?, kind? }`                             | 403 unless the row's `author` is `'agent'` and it belongs to the target task.                                            |
| `review.drafts_delete` | no       | `{ taskId?, id }`                                                                 | Same rule as update.                                                                                                     |

- All four use `target: { taskId }` and `defaultTargetToSelf: true`, and allow `orchestrator` and `task` callers. Scope stays in `scope.ts` (a task sees itself and its children). Handlers do no scope checks of their own.
- `provider` defaults from the target task's project remote, which the handler resolves through injected deps (`appDeps.ts` → `reviewDeps()`).
- Every write emits `diffComments:changed`.
- The agent reads the PR itself (via `gh` or `az`). No thread-reading capability in v1.
- Names go through `naming.ts` (`review.drafts_create` → `review_drafts_create`). Only `drafts_list` is auto-allowed (`readOnly`).
- The README's "Controlling Dash from other agents" section gets a short review-drafts paragraph.

## Phases

Each phase lands separately, bumps the version, and is smoke-tested in a dev instance.

1. **GitHub read:**
   - neutral types and the provider interface, with the GitHub `load` covering all threads and the conversation;
   - `prReviewIpc`;
   - the PR picker tab;
   - the `provider` in the view and scope;
   - the resolved pill;
   - the Conversation and off-code sections (read-only).
2. **GitHub write:** the migration (`side`, `reply_to`, `author`), comments in the PR view, reply drafts, resolve and reactivate, the Submit footer, and `submit` with rollback and error mapping.
3. **Agent drafts:** `review.*` capabilities, `diffCommentEvents` with the store reload, and the README.
4. **ADO:** the adapter (load, head fetch, resolve, submit, vote) and the picker listing ADO PRs. (Iteration tracking was verified while designing; see the ADO section.)

## Testing

Pure-node vitest, no jsdom.

- **Adapters:** GitHub and ADO mappers from recorded JSON fixtures:
  - thread states, LEFT and RIGHT, outdated, system-thread filtering, conversation ordering;
  - mutation and request builders (GraphQL variables, ADO bodies and vote values);
  - error mapping (scope, pending review).
- **Submit orchestration:** with a fake transport.
  - GitHub: a failure at reply or submit deletes the pending review and posts nothing.
  - ADO: a failure on the third post returns the first two `draftId`s.
- **Drafts:** `diffCommentsIpc` row mapping for the new columns; prune skips `pr:*`.
- **Capabilities:** `review.test.ts` on fakes, following `services.test.ts`:
  - default-to-self;
  - updating a user draft gives 403;
  - a child task is reachable and a sibling isn't;
  - `drafts_list` is in `readOnlyNames`.
- **Renderer:** `commentScope` for `pr:<provider>:<n>`. No stored-view test: PR views aren't restored.

## End-to-end check (dev instance, CDP)

1. Open a task in a GitHub repo with an open PR. Choose Compare → Pull requests → the PR. The diff matches GitHub's "Files changed". Resolved threads show as pills, unresolved ones open, and the Conversation lists general comments.
2. Add a range comment and a reply. Resolve one thread, and check on GitHub that it's resolved at once. Submit with "Request changes". On GitHub: one review, the range comment, the reply in its thread, the verdict. The drafts disappear from Dash.
3. From the task's agent: `review_drafts_create` on the PR. The bubble appears in the open editor, tagged "agent". `review_drafts_update` on a user draft is refused.
4. Revoke the token's `repo` scope (or use a read-only PAT for ADO) and submit. You see the fix text, and the drafts are still there.
5. Repeat steps 1–3 on an ADO PR, with the vote "Approve with suggestions".
