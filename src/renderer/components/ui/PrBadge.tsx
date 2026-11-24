import { GitMerge, GitPullRequestArrow, GitPullRequestClosed, Wrench } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { IconButton } from './IconButton';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { ciLabel, ciPulse, prStatusText } from './prStatusColors';
import { badgeVariants } from './Badge';
import { buttonVariants } from './Button';
import { menuItem, menuLabel } from './styles';
import { cn } from '../../lib/cn';
import { fixCi } from '../../utils/fixCi';
import type { PullRequestInfo } from '../../../shared/types';

interface PrBadgeProps {
  /** The PRs standing for the branch now, newest first (see relevantPrs). */
  prs: PullRequestInfo[];
  /** Every PR from the branch, newest first, listed when the badge is clicked;
   *  with no current PR the newest of these shows muted. */
  allPrs?: PullRequestInfo[];
  size?: 'sm' | 'md';
  /** `pill` (default) shows "PR #n"; `icon` is just the state icon, for dense
   *  rows like the sidebar task list; `button` is the icon on an icon button's
   *  30px square, for a header row of icon buttons. */
  variant?: 'pill' | 'icon' | 'button';
  /** The task these PRs belong to; enables "Fix CI" on a PR whose checks fail. */
  taskId?: string;
}

// No fill: the state colour is carried by the icon (and text) alone; a
// neutral tint on hover keeps it reading as clickable.
const HOVER = 'transition-colors hover:bg-hover';
const MUTED = 'text-ink-3';

function stateText(pr: PullRequestInfo): string {
  return pr.state === 'open' && pr.ci ? `open, ${ciLabel(pr.ci)}` : pr.state;
}

function describe(pr: PullRequestInfo): string {
  return `PR #${pr.number}: ${pr.title} (${stateText(pr)})`;
}

/** The icon's colour: an open PR's red while its checks fail, amber while they
 *  run, else its state's. */
function iconColor(pr: PullRequestInfo): string {
  if (pr.state === 'open' && pr.ci === 'failing') return 'text-state-fail';
  if (pr.state === 'open' && pr.ci === 'pending') return 'text-state-needs';
  return prStatusText(pr.state);
}

/** The state label's colour: an open PR's checks when it has any, else its state. */
function stateTextColor(pr: PullRequestInfo): string {
  if (pr.state !== 'open' || !pr.ci) return prStatusText(pr.state);
  return pr.ci === 'failing'
    ? 'text-state-fail'
    : pr.ci === 'pending'
      ? 'text-state-needs'
      : 'text-state-done';
}

/** The pulse while an open PR's checks run, else nothing. */
function pulse(pr: PullRequestInfo): string {
  return pr.state === 'open' && pr.ci ? ciPulse(pr.ci) : '';
}

/** The PR's state icon; pulses while its checks run unless `still`. */
function StateIcon({ pr, size, still }: { pr: PullRequestInfo; size: number; still?: boolean }) {
  const Icon =
    pr.state === 'merged'
      ? GitMerge
      : pr.state === 'closed'
        ? GitPullRequestClosed
        : GitPullRequestArrow;
  return <Icon size={size} strokeWidth={size < 14 ? 2 : 1.8} className={still ? '' : pulse(pr)} />;
}

/** "Fix CI" for a GitHub PR with failing checks: types a prompt pointing at them into the task. */
function FixCiButton({ pr, taskId }: { pr: PullRequestInfo; taskId?: string }) {
  if (!taskId || pr.provider !== 'github' || pr.state !== 'open' || pr.ci !== 'failing') {
    return null;
  }
  return (
    <IconButton
      title={`Fix CI: send PR #${pr.number}'s failed checks to this task`}
      size="sm"
      variant="destructive"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void fixCi(taskId, pr);
      }}
    >
      <Wrench size={14} strokeWidth={1.8} />
    </IconButton>
  );
}

/**
 * One PR as a row that opens it: state icon, number, title, state label, and
 * "Fix CI" when its checks fail. A past (not current) PR reads quieter. The
 * PR list's rows; the Details tab lists the task's PRs with it too.
 */
export function PrRow({ pr, taskId }: { pr: PullRequestInfo; taskId?: string }) {
  return (
    <div className="flex items-center gap-1">
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(menuItem, 'min-w-0 flex-1 hover:bg-hover', !pr.current && 'text-ink-2')}
      >
        <span className={cn(badgeVariants({ tone: 'bare', size: 'icon' }), iconColor(pr))}>
          <StateIcon pr={pr} size={11} />
        </span>
        <span className="shrink-0 tabular-nums text-ink-3">#{pr.number}</span>
        <span className="truncate flex-1 min-w-0">{pr.title}</span>
        <span className={`shrink-0 text-xs ${stateTextColor(pr)}`}>{stateText(pr)}</span>
      </a>
      <FixCiButton pr={pr} taskId={taskId} />
    </div>
  );
}

/** Every PR from the branch, newest first; each row opens the PR. */
function PrList({ prs, taskId }: { prs: PullRequestInfo[]; taskId?: string }) {
  return (
    <PopoverContent
      align="end"
      className="min-w-65 max-w-95"
      onClick={(e) => e.stopPropagation()}
      // Don't land focus (and its ring) on the first row's Fix CI button.
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className={menuLabel}>PRs from this branch</div>
      {prs.map((pr) => (
        <PrRow key={pr.number} pr={pr} taskId={taskId} />
      ))}
    </PopoverContent>
  );
}

/**
 * A task's PR, its icon coloured by state as on GitHub (open green, merged
 * purple, closed red with the closed-PR icon). An open PR's icon turns red
 * while its checks fail (its open-PR icon keeps it apart from a closed one),
 * and amber, pulsing like the busy session orb, while they run. Clicking lists every PR from the branch. With no
 * current PR, the branch's newest past one shows muted. The pill variants
 * hide a closed PR; the icon variant always renders. Shared by the task header
 * (button), the ProjectView task cards (sm pill) and the sidebar rows (icon).
 */
export function PrBadge({ prs, allPrs, size = 'md', variant = 'pill', taskId }: PrBadgeProps) {
  const list = allPrs && allPrs.length > 0 ? allPrs : prs;
  const pr = prs[0] ?? list[0];
  if (!pr) return null;
  const isCurrent = prs.length > 0;
  const colorCls = `${isCurrent ? iconColor(pr) : MUTED} ${HOVER}`;
  const tooltip =
    (isCurrent ? describe(pr) : `Past PR #${pr.number}: ${pr.title} (${pr.state})`) +
    (list.length > 1 ? `; click for all ${list.length}` : '');

  if (variant === 'icon' || variant === 'button') {
    // The button's ghost hover recolours its text, so its icon carries the
    // state colour itself.
    const isButton = variant === 'button';
    const tint = isCurrent ? iconColor(pr) : MUTED;
    return (
      <Popover>
        <Tooltip content={tooltip}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`PR #${pr.number}`}
              className={
                isButton
                  ? buttonVariants({ variant: 'ghost', size: 'icon' })
                  : cn(badgeVariants({ tone: 'bare', size: 'icon' }), colorCls)
              }
            >
              <span className={cn('flex', isButton && tint)}>
                <StateIcon pr={pr} size={isButton ? 14 : 11} still={!isCurrent} />
              </span>
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PrList prs={list} taskId={taskId} />
      </Popover>
    );
  }

  if (isCurrent && pr.state === 'closed') return null;
  const iconSize = size === 'sm' ? 10 : 11;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Popover>
        <Tooltip content={tooltip}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(badgeVariants({ tone: 'bare', size }), colorCls)}
            >
              <StateIcon pr={pr} size={iconSize} still={!isCurrent} />
              PR #{pr.number}
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PrList prs={list} taskId={taskId} />
      </Popover>
      {isCurrent && <FixCiButton pr={pr} taskId={taskId} />}
    </span>
  );
}
