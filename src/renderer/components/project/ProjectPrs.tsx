import { CircleAlert, GitPullRequestArrow, Plus } from 'lucide-react';
import type { ProjectPr } from '../../../shared/projectPrs';
import type { Project, PullRequest, RelevantPr } from '../../../shared/types';
import { useProjectPrList, usePrDetails } from '../../hooks/useProjectPrs';
import { cn } from '../../lib/cn';
import { prKey } from '../../stores/prReviewStore';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { PrCard } from '../review/ListedPr';
import { Button } from '../ui/Button';
import { CountBadge } from '../ui/CountBadge';
import { EmptyState } from '../ui/EmptyState';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { ActivityDot } from './ActivityDot';
import { PR_GROUPS, prListView, prRowRoute, type PrRowRoute } from './projectPrRows';

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
 * else), each the PR card (`PrCard`, the task PRs view's own), read from the
 * forge alone: the page never fetches into the
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
            <div className="grid gap-2 lg:grid-cols-2">
              {view.groups[g.key].map((entry) => (
                <PrItem
                  key={prKey(entry.pr.provider, entry.pr.number)}
                  entry={entry}
                  project={project}
                  actions={actions}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** One PR: its card (`PrCard`, the task PRs view's own), its details read
 *  from the forge alone, its task (or Start task) at the title's end. Every
 *  way into review mode goes through a task. */
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
  const route = prRowRoute(taskId);
  const { details, error } = usePrDetails(project.id, pr);
  return (
    <PrCard
      pr={pr}
      details={details}
      error={error}
      remote={project.gitRemote ?? null}
      actions={<TaskCell pr={pr} projectId={project.id} route={route} actions={actions} />}
      onReview={() =>
        route.kind === 'task' ? actions.reviewInTask(route.taskId, pr) : actions.startTask(pr, true)
      }
    />
  );
}

/** The task on the PR's head, a click away; or, with none, a way to start one. */
function TaskCell({
  pr,
  projectId,
  route,
  actions,
}: {
  pr: RelevantPr;
  projectId: string;
  route: PrRowRoute;
  actions: ProjectPrActions;
}) {
  if (route.kind === 'task')
    return <TaskChip projectId={projectId} taskId={route.taskId} actions={actions} />;
  return (
    <span>
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

/** Cards the size of the list's, while it's first listed. */
function LoadingRows() {
  return (
    <div className="grid max-w-5xl gap-2" role="status" aria-label="Listing pull requests">
      <Skeleton className="mx-2.5 mb-2 h-4 w-28" />
      <div className="grid gap-2 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-2.5 rounded-xl border border-line px-4 py-3.5">
            <Skeleton className={cn('h-4', i % 2 ? 'w-64' : 'w-80')} />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-72" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        ))}
      </div>
    </div>
  );
}
