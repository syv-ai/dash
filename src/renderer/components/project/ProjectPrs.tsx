import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, CircleDot, GitPullRequestArrow, MessageSquare, Plus } from 'lucide-react';
import type { ProjectPr } from '../../../shared/projectPrs';
import type { Project, PullRequest, RelevantPr } from '../../../shared/types';
import { useProjectPrList, usePrDetails } from '../../hooks/useProjectPrs';
import { cn } from '../../lib/cn';
import { useSectionOpen } from '../../lib/useSectionOpen';
import { prKey } from '../../stores/prReviewStore';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { ChecksRollupIcon } from '../review/ChecksRollupIcon';
import { PrCard } from '../review/ListedPr';
import { Button } from '../ui/Button';
import { CountBadge } from '../ui/CountBadge';
import { DisclosureChevron } from '../ui/DisclosureChevron';
import { ListRow } from '../ui/ListRow';
import { EmptyState } from '../ui/EmptyState';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { TextLink } from '../ui/TextLink';
import { Tooltip } from '../ui/Tooltip';
import { prStateIcon, prStatusText, shownPrState } from '../ui/prStatusColors';
import { ActivityDot } from './ActivityDot';
import { PR_GROUPS, prListView, prRowFacts, prRowRoute, type PrRowRoute } from './projectPrRows';

/** What a row's actions do, by the page. */
export interface ProjectPrActions {
  /** Show the task. */
  goToTask: (taskId: string) => void;
  /** Open the new-task flow on the PR's head; `review` enters review mode on
   *  it once the task is made. */
  startTask: (pr: PullRequest, review: boolean) => void;
  /** Show the task, in review mode on the PR. */
  reviewInTask: (taskId: string, pr: PullRequest) => void;
}

/**
 * The project page's Pull requests: every open PR of the project, grouped by
 * where you stand on it (`groupProjectPrs`: waiting on you, yours, everyone
 * else), each a row that unfolds into the PR card (`PrCard`, the task PRs
 * view's own), read from the forge alone: the page never fetches into the
 * project's checkout. Loading, a forge Dash can't ask, no open PRs and a
 * failed listing each say so.
 */
export function ProjectPrs({
  project,
  actions,
}: {
  project: Pick<Project, 'id' | 'gitRemote'>;
  actions: ProjectPrActions;
}) {
  const { listing, groups, reload } = useProjectPrList(project.id);
  const view = prListView(listing, groups, project.gitRemote ?? null);
  switch (view.kind) {
    case 'loading':
      return <LoadingRows />;
    case 'unsupported':
      return (
        <EmptyState
          illustration={GitPullRequestArrow}
          title="No pull requests to list"
          description={view.reason}
        />
      );
    case 'failed':
      return (
        <EmptyState
          illustration={CircleAlert}
          title="Could not list the pull requests"
          description={view.error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      );
    case 'empty':
      return (
        <EmptyState
          illustration={GitPullRequestArrow}
          title="No open pull requests"
          description="Pull requests opened on this project show here."
        />
      );
  }
  return (
    <div className="grid max-w-5xl gap-6">
      {view.error && (
        <Notice icon={<CircleAlert size={14} strokeWidth={1.8} />}>
          Could not list them again ({view.error}); these are as last listed.
        </Notice>
      )}
      {PR_GROUPS.map((g) => (
        <section key={g.key} aria-label={g.title} className="grid gap-1">
          <h2 className="type-heading flex items-center gap-2 px-2.5 pb-1">
            {g.title}
            <CountBadge count={view.groups[g.key].length} />
          </h2>
          {view.groups[g.key].length === 0 ? (
            <p className="type-caption px-2.5">{g.empty}</p>
          ) : (
            view.groups[g.key].map((entry) => (
              <PrItem
                key={prKey(entry.pr.provider, entry.pr.number)}
                entry={entry}
                project={project}
                actions={actions}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

/** One PR: its row, which unfolds into its card (`PrCard`), the card's
 *  fold folding it back to the row. The fold is kept for the session, per
 *  project PR. */
function PrItem({
  entry,
  project,
  actions,
}: {
  entry: ProjectPr;
  project: Pick<Project, 'id' | 'gitRemote'>;
  actions: ProjectPrActions;
}) {
  const { pr, taskId } = entry;
  const sectionId = `projectPrs.${project.id}.${prKey(pr.provider, pr.number)}`;
  const row = useSectionOpen(sectionId, false);
  const route = prRowRoute(taskId);
  if (!row.open)
    return (
      <PrRow
        pr={pr}
        projectId={project.id}
        route={route}
        onUnfold={() => row.onOpenChange(true)}
        actions={actions}
      />
    );
  return (
    <ExpandedPr
      pr={pr}
      taskId={taskId}
      project={project}
      sectionId={sectionId}
      fold={row}
      task={<TaskCell pr={pr} projectId={project.id} route={route} actions={actions} />}
      onReview={() =>
        route.kind === 'task' ? actions.reviewInTask(route.taskId, pr) : actions.startTask(pr, true)
      }
    />
  );
}

/** The card, its details fetched from the forge while it's unfolded. */
function ExpandedPr({
  pr,
  taskId,
  project,
  sectionId,
  fold,
  task,
  onReview,
}: {
  pr: RelevantPr;
  taskId: string | null;
  project: Pick<Project, 'id' | 'gitRemote'>;
  sectionId: string;
  fold: { open: boolean; onOpenChange: (open: boolean) => void };
  /** Its task, or Start task: the row's, at the card's title. */
  task: ReactNode;
  onReview: () => void;
}) {
  const { details, error } = usePrDetails(project.id, pr);
  return (
    <div className="py-1">
      <PrCard
        pr={pr}
        review={details}
        error={error}
        remote={project.gitRemote ?? null}
        taskId={taskId}
        about={fold}
        sectionId={sectionId}
        actions={task}
        // Every way into review mode goes through a task: the view it lands
        // on is review mode's own (Overview).
        onReview={() => onReview()}
      />
    </div>
  );
}

/**
 * A PR folded: its state, title and number, who opened it and the issues it
 * closes, then, in columns that line up down the list, the task on its head
 * (or a way to start one), its checks, open threads and how long since it
 * moved.
 */
function PrRow({
  pr,
  projectId,
  route,
  onUnfold,
  actions,
}: {
  pr: RelevantPr;
  projectId: string;
  route: PrRowRoute;
  /** Unfold it into its card. */
  onUnfold: () => void;
  actions: ProjectPrActions;
}) {
  const state = shownPrState(pr);
  const StateIcon = prStateIcon(state);
  const facts = prRowFacts(pr, Date.now() / 1000);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onUnfold();
  };
  return (
    <ListRow
      as="div"
      role="button"
      tabIndex={0}
      aria-expanded={false}
      onClick={onUnfold}
      onKeyDown={onKeyDown}
      className="cursor-pointer"
      leading={
        <span className="flex items-center gap-1.5">
          <DisclosureChevron open={false} />
          <StateIcon
            size={14}
            strokeWidth={1.8}
            className={prStatusText(state)}
            aria-label={`${state} pull request`}
          />
        </span>
      }
      badges={
        <span className="type-caption flex items-center gap-1.5">
          <span className="tabular-nums">#{pr.number}</span>
          <span className="max-w-32 truncate">{pr.author}</span>
        </span>
      }
      trailing={
        <>
          <Issues pr={pr} />
          {/* A column of its own, so the issues before it line up too. */}
          <span className="flex w-44 justify-end">
            <TaskCell pr={pr} projectId={projectId} route={route} actions={actions} inRow />
          </span>
          <span className="flex w-5 justify-center">
            {pr.ci && <ChecksRollupIcon ci={pr.ci} />}
          </span>
          <span className="flex w-9 justify-end">
            {!!facts.openThreads && (
              <Tooltip content={facts.threadsTitle}>
                <span className="type-caption flex items-center gap-1 tabular-nums">
                  <MessageSquare size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
                  {facts.openThreads}
                </span>
              </Tooltip>
            )}
          </span>
          <Tooltip content={facts.updatedTitle}>
            <span className="type-caption w-8 text-right tabular-nums">{facts.updated}</span>
          </Tooltip>
        </>
      }
    >
      {pr.title}
    </ListRow>
  );
}

/** The issues the PR closes (its ADO work items), each linked; the first two. */
function Issues({ pr }: { pr: RelevantPr }) {
  const issues = pr.issues ?? [];
  if (issues.length === 0) return null;
  return (
    <span className="type-caption flex items-center gap-1 tabular-nums">
      <CircleDot size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
      <span onClick={(e) => e.stopPropagation()}>
        {issues.slice(0, 2).map((issue, i) => (
          <Fragment key={issue.number}>
            {i > 0 && ', '}
            <TextLink href={issue.url} title={issue.title || `Open #${issue.number}`}>
              #{issue.number}
            </TextLink>
          </Fragment>
        ))}
        {issues.length > 2 && ` +${issues.length - 2}`}
      </span>
    </span>
  );
}

/** The task on the PR's head, a click away; or, with none, a way to start one. */
function TaskCell({
  pr,
  projectId,
  route,
  actions,
  inRow = false,
}: {
  pr: RelevantPr;
  projectId: string;
  route: PrRowRoute;
  actions: ProjectPrActions;
  /** In a folded row: Start task shows on the row's hover or focus only. */
  inRow?: boolean;
}) {
  if (route.kind === 'task')
    return <TaskChip projectId={projectId} taskId={route.taskId} actions={actions} />;
  return (
    // In a row, on its hover or focus only: on every row at rest it would be
    // the list's loudest word. Its room is kept, so nothing shifts.
    <span
      className={cn(
        inRow &&
          'opacity-0 transition-opacity duration-quick group-focus-within/row:opacity-100 group-hover/row:opacity-100',
      )}
    >
      <Tooltip content="A new task on its branch, to work on or review it">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            actions.startTask(pr, false);
          }}
        >
          <Plus size={14} strokeWidth={1.8} className="text-icon" />
          Start task
        </Button>
      </Tooltip>
    </span>
  );
}

function TaskChip({
  projectId,
  taskId,
  actions,
}: {
  projectId: string;
  taskId: string;
  actions: ProjectPrActions;
}) {
  const task = useProjects(
    (s) => s.tasksByProject[projectId]?.find((t) => t.id === taskId) ?? null,
  );
  const activity = useRuntime((s) => s.taskActivity[taskId]);
  if (!task) return null;
  return (
    <Tooltip content="Go to its task">
      <Button
        variant="secondary"
        size="sm"
        className="max-w-44"
        onClick={(e) => {
          e.stopPropagation();
          actions.goToTask(taskId);
        }}
      >
        <ActivityDot info={activity} />
        <span className="truncate">{task.name}</span>
      </Button>
    </Tooltip>
  );
}

/** Rows the size of the list's, while it's first listed. */
function LoadingRows() {
  return (
    <div className="grid max-w-5xl gap-1" role="status" aria-label="Listing pull requests">
      <Skeleton className="mx-2.5 mb-2 h-4 w-28" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-9 items-center gap-2 px-2.5">
          <Skeleton shape="circle" className="size-3.5" />
          <Skeleton className={cn('h-3.5', i % 2 ? 'w-80' : 'w-96')} />
          <Skeleton className="ml-auto h-3.5 w-24" />
          <Skeleton className="h-3.5 w-8" />
        </div>
      ))}
    </div>
  );
}
