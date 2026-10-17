import { GitMerge, GitPullRequestArrow, GitPullRequestClosed, Wrench } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { IconButton } from './IconButton';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { ciLabel, ciPulse, prStatusText } from './prStatusColors';
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
   *  rows like the sidebar task list. */
  variant?: 'pill' | 'icon';
  /** The task these PRs belong to; enables "Fix CI" on a PR whose checks fail. */
  taskId?: string;
}

// No fill: the state colour is carried by the icon (and text) alone; a
// neutral tint on hover keeps it reading as clickable.
const HOVER = 'hover:bg-foreground/5';
const MUTED = 'text-muted-fade-70';

function stateText(pr: PullRequestInfo): string {
  return pr.state === 'open' && pr.ci ? `open, ${ciLabel(pr.ci)}` : pr.state;
}

function describe(pr: PullRequestInfo): string {
  return `PR #${pr.number}: ${pr.title} (${stateText(pr)})`;
}

/** The icon's colour: an open PR's red while its checks fail, amber while they
 *  run, else its state's. */
function iconColor(pr: PullRequestInfo): string {
  if (pr.state === 'open' && pr.ci === 'failing') return 'text-destructive';
  if (pr.state === 'open' && pr.ci === 'pending') return 'text-[hsl(var(--git-modified))]';
  return prStatusText(pr.state);
}

/** The state label's colour: an open PR's checks when it has any, else its state. */
function stateTextColor(pr: PullRequestInfo): string {
  if (pr.state !== 'open' || !pr.ci) return prStatusText(pr.state);
  return pr.ci === 'failing'
    ? 'text-destructive'
    : pr.ci === 'pending'
      ? 'text-[hsl(var(--git-modified))]'
      : 'text-[hsl(var(--git-added))]';
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

/** Every PR from the branch, newest first; each row opens the PR. */
function PrList({ prs, taskId }: { prs: PullRequestInfo[]; taskId?: string }) {
  return (
    <PopoverContent
      align="end"
      className="p-1 min-w-[260px] max-w-[380px]"
      onClick={(e) => e.stopPropagation()}
      // Don't land focus (and its ring) on the first row's Fix CI button.
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider font-mono text-muted-fade-70">
        PRs from this branch
      </div>
      {prs.map((pr) => (
        <div key={pr.number} className="flex items-center gap-1">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-accent transition-colors ${
              pr.current ? '' : 'text-fg-fade-70'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center rounded-md w-[18px] h-[18px] shrink-0 ${iconColor(pr)}`}
            >
              <StateIcon pr={pr} size={11} />
            </span>
            <span className="font-mono text-muted-fade-70 shrink-0">#{pr.number}</span>
            <span className="truncate flex-1 min-w-0">{pr.title}</span>
            <span className={`shrink-0 text-[11px] ${stateTextColor(pr)}`}>{stateText(pr)}</span>
          </a>
          <FixCiButton pr={pr} taskId={taskId} />
        </div>
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
 * (md pill), the ProjectView task cards (sm pill) and the sidebar rows (icon).
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

  if (variant === 'icon') {
    return (
      <Popover>
        <Tooltip content={tooltip}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`PR #${pr.number}`}
              className={`inline-flex items-center justify-center rounded-md w-[18px] h-[18px] shrink-0 transition-colors ${colorCls}`}
            >
              <StateIcon pr={pr} size={11} still={!isCurrent} />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PrList prs={list} taskId={taskId} />
      </Popover>
    );
  }

  if (isCurrent && pr.state === 'closed') return null;
  const iconSize = size === 'sm' ? 10 : 11;
  const sizeCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-[3px] text-[11px]';
  return (
    <span className="inline-flex items-center gap-0.5">
      <Popover>
        <Tooltip content={tooltip}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1 rounded-full font-mono transition-colors ${sizeCls} ${colorCls}`}
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
