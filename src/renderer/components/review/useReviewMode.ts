import { useEffect, useMemo, useRef } from 'react';
import type { PrRef, PrReview, RelevantPrs, Task } from '../../../shared/types';
import { prScope } from '../../../shared/prScope';
import { useGit } from '../../stores/gitStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { unresolvedThreads } from '../../utils/prReviewNotices';
import type { PrEntry } from '../diffEditor/HistoryList';
import type { CommitSummary } from '../diffEditor/types';
import { usePrCommits } from '../diffEditor/data/usePrCommits';
import { openFileAt } from '../diffEditor/openFileAt';
import type { OpenOptions } from '../diffEditor/tabs/editorLayout';
import type { EditorWorkspace } from '../diffEditor/useEditorWorkspace';
import {
  firstChangedTreeFile,
  segmentOnMode,
  viewForMode,
  viewOnSegment,
  type CodeSegment,
} from '../rightInspector/sidebarState';
import { branchPr, type BranchPr } from './branchPr';
import { firstOpenThread, threadRange } from './outline';
import { useTaskPrs } from './useTaskPrs';

/** What review mode needs of the task sidebar it runs in. */
export interface ReviewModeSidebar {
  /** The view the sidebar shows. */
  segment: CodeSegment | 'details';
  /** Show a view (also where Details returns to). */
  showSegment: (next: CodeSegment) => void;
  /** Open a file in the editor, expanding the sidebar. */
  openFile: (path: string, opts?: OpenOptions) => void;
  /** Expand on the editor as it is. */
  openEditor: () => void;
}

export interface ReviewMode {
  /** The PR the task is in review mode for; null in normal mode (and until
   *  main has said). */
  mode: PrRef | null;
  /** That PR's review as last fetched. */
  review: PrReview | null;
  /** The open PRs from and into the branch; null until first listed. */
  relevant: RelevantPrs | null;
  /** List the relevant PRs again (the PR button opening). */
  refreshPrs: () => void;
  /** The branch's own PR and its unresolved threads (the PR button's badge). */
  own: (BranchPr & { threads: number }) | null;
  /** History's row for the branch's own PR (normal mode only). */
  historyPr: PrEntry | null;
  /** In review mode, History's commits: the PR's. Null in normal mode. */
  commits: { commits: CommitSummary[]; loading: boolean } | null;
  enter: (pr: PrRef) => void;
  exit: () => void;
  /** Open a file of the PR in the PR's view. */
  openFile: (path: string, opts?: OpenOptions) => void;
  /** Expand on a re-picked narrow view, when review mode decides what opens
   *  (Overview and Files: the PR's first changed file; Comments: the first
   *  open thread's, at its line). False: it doesn't. */
  expandOn: (on: CodeSegment) => boolean;
  /** What picking a view does to the editor's view (leaving History). */
  onSegment: (to: CodeSegment) => void;
  /** Show a draft or note where it was written, leaving review mode for one
   *  outside the PR. */
  navigate: (scope: string, path: string, commentId: string) => void;
}

/**
 * Review mode's state machine for the task sidebar (spec Revision 3):
 * entering and exiting, the editor following the mode's PR (its view at the
 * loaded head, a push re-pointing it), Overview being the mode's alone, the
 * branch's own PR (one source for the PR button and History's row), and the
 * PR's commits for History. The rules are `sidebarState`'s; this applies
 * them to the sidebar's segment and the editor's workspace.
 */
export function useReviewMode(
  task: Pick<Task, 'id' | 'branch' | 'path' | 'projectId'>,
  ws: Pick<EditorWorkspace, 'view' | 'selectView' | 'showPr' | 'navigateToComment'>,
  sidebar: ReviewModeSidebar,
): ReviewMode {
  const taskPrs = useTaskPrs(task);
  const mode = taskPrs.mode ?? null;
  const reviewing = mode !== null;
  const modeKey = mode ? prKey(mode.provider, mode.number) : null;
  const review = usePrReviews((s) => (modeKey ? (s.byPr[modeKey] ?? null) : null));
  const { view, selectView, showPr } = ws;
  const { segment, showSegment } = sidebar;

  // ── The branch's own PR: the PR button's badge and History's row ──
  const detected = useGit((s) => s.prByTask[task.id]);
  const ownPr = branchPr(taskPrs.relevant, detected);
  const ownReview = usePrReviews((s) =>
    ownPr ? s.byPr[prKey(ownPr.provider, ownPr.number)] : undefined,
  );
  const ownThreads = ownReview ? unresolvedThreads(ownReview).length : 0;
  // Its review is fetched once if nothing has yet (D123).
  const ownNumber = ownPr?.number;
  const ownLoaded = !!ownReview;
  useEffect(() => {
    if (ownNumber !== undefined && !ownLoaded)
      void usePrReviews.getState().load(task.projectId, task.path, ownNumber);
  }, [ownNumber, ownLoaded, task.projectId, task.path]);

  const showView = (next: 'pr' | 'working' | null) => {
    if (next === 'working') selectView({ kind: 'working', ref: 'HEAD' });
    else if (next === 'pr' && mode) void showPr(mode);
  };
  // The editor follows review mode: the PR's view at its loaded head while
  // in it (a push re-points it), never a PR's view out of it. However the
  // mode ends (✕, main ending it, a jump to a note outside the PR), one rule
  // applies on the render it ends (`viewOnExit`), then any jump waiting on it.
  const follow = viewForMode({ mode, view, review });
  const latest = useRef({ mode, view, review, showView });
  latest.current = { mode, view, review, showView };
  const modeBefore = useRef(modeKey);
  const afterExit = useRef<(() => void) | null>(null);
  useEffect(() => {
    const ended = modeBefore.current !== null && modeKey === null;
    modeBefore.current = modeKey;
    const now = latest.current;
    now.showView(viewForMode({ mode: now.mode, ended, view: now.view, review: now.review }));
    const then = afterExit.current;
    afterExit.current = null;
    then?.();
  }, [follow, modeKey, review?.head]);
  // A task found in review mode, or entering it, shows Overview; Overview
  // and Comments are the mode's alone, so ending the mode leaves them for
  // Changes. Read off
  // the mode before (the sidebar starts on `initialSegment`'s).
  const known = taskPrs.mode === undefined ? undefined : reviewing;
  const knownBefore = useRef(known);
  useEffect(() => {
    const was = knownBefore.current;
    knownBefore.current = known;
    const next = segmentOnMode({ segment, was, now: known });
    if (next !== segment && next !== 'details') showSegment(next);
  }, [segment, known, showSegment]);

  const enter = (pr: PrRef) =>
    usePrReviews.getState().setMode(task.id, { provider: pr.provider, number: pr.number });
  // Ending it is all an exit does: the follow effect moves the editor.
  const exit = () => usePrReviews.getState().setMode(task.id, null);
  const openFile = (path: string, opts?: OpenOptions) => {
    if (mode && view.kind !== 'pr') void showPr(mode);
    sidebar.openFile(path, opts ?? { preview: true });
  };

  // History: in review mode the PR's commits (base..head, read from the checkout).
  const prRange = useMemo(
    () => (review ? { number: review.number, base: review.base, head: review.head } : null),
    [review],
  );
  const prCommits = usePrCommits(task.path, prRange);

  const historyPr: PrEntry | null =
    !reviewing && ownPr
      ? {
          number: ownPr.number,
          title: ownPr.title,
          body: ownReview?.body ?? null,
          threads: ownReview ? ownThreads : null,
          onPeek: () => {
            if (!ownReview)
              void usePrReviews.getState().load(task.projectId, task.path, ownPr.number);
          },
          onOpen: () => enter(ownPr),
        }
      : null;

  return {
    mode,
    review,
    relevant: taskPrs.relevant,
    refreshPrs: taskPrs.refresh,
    own: ownPr && { ...ownPr, threads: ownThreads },
    historyPr,
    commits: prRange ? prCommits : null,
    enter,
    exit,
    openFile,
    expandOn: (on) => {
      if (!mode || on === 'history' || on === 'changes') return false;
      if (on === 'comments') {
        const thread = review && firstOpenThread(review.threads);
        if (!thread) return true;
        if (view.kind !== 'pr') void showPr(mode);
        openFileAt(thread.path, threadRange(thread));
        return true;
      }
      const path = firstChangedTreeFile(review?.files.map((f) => f.path) ?? []);
      if (path) openFile(path);
      else sidebar.openEditor();
      return true;
    },
    onSegment: (to) => showView(viewOnSegment({ reviewing, to, viewKind: view.kind })),
    navigate: (scope, path, commentId) => {
      // Review mode shows its PR only: a note written elsewhere (the working
      // tree, a commit) is shown outside it, once the exit has moved the editor.
      const jump = () => ws.navigateToComment(scope, path, commentId);
      if (mode && scope !== prScope(mode.provider, mode.number)) {
        afterExit.current = jump;
        exit();
      } else jump();
      sidebar.openEditor();
    },
  };
}

/** The view the task sidebar opens on: Overview for a task already in
 *  review mode (as far as the store knows), else Changes. */
export function initialSegment(taskId: string): 'overview' | 'changes' {
  const entry = usePrReviews.getState().prs[taskId];
  return segmentOnMode({
    segment: 'changes',
    was: undefined,
    now: entry ? entry.mode !== null : undefined,
  });
}
