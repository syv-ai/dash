import React, { useState, useCallback, useEffect } from 'react';
import {
  GitBranch,
  GitPullRequestArrow,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowRight,
} from 'lucide-react';
import type { BranchInfo, PullRequest, PullRequestState } from '../../../shared/types';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '../ui/Command';
import { Segmented } from '../ui/Segmented';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { Notice } from '../ui/Notice';
import { PrNumberBadge } from '../ui/PrBadge';
import { prStatusText } from '../ui/prStatusColors';
import { SelectTrigger } from '../ui/Select';
import { TextLink } from '../ui/TextLink';

type PickerTab = 'branch' | 'pr';

interface BranchPrPickerProps {
  branches: BranchInfo[];
  selectedBranch: BranchInfo | null;
  branchLoading: boolean;
  branchError: string | null;
  onSelectBranch: (b: BranchInfo) => void;
  onRetry: () => void;
  /** Show the "Pull requests" group. */
  showPrs: boolean;
  /** Flag branches that are already checked out as "in use". Only meaningful
   *  when the selection will be checked out directly — branching off one is
   *  fine, so the caller passes false in new-branch mode to avoid noise. */
  markInUse: boolean;
  /** Show the ahead/behind badges. Hidden when the task is cut from the fetched
   *  remote ref, since the local branch's state isn't used then. */
  showUpstream: boolean;
  projectPath: string;
  /** The project, whose forge main asks for its PRs; without one there are none. */
  projectId?: string;
  /** Fired after the PR head has been fetched into `branch`. `checkedOut` is
   *  true when that branch is already checked out elsewhere. */
  onSelectPr: (branch: string, prTitle: string, checkedOut: boolean) => void;
}

/**
 * Combined branch + PR picker — one Combobox (Radix Popover + cmdk Command)
 * with a Branches / Pull requests tab (Segmented) at the top. Each tab has its
 * own searchable list, so a long branch list never buries the PRs. Selecting a
 * PR fetches its head branch, then reports it via onSelectPr exactly like
 * picking a branch. PRs load lazily the first time the PR tab is opened.
 */
export function BranchPrPicker({
  branches,
  selectedBranch,
  branchLoading,
  branchError,
  onSelectBranch,
  onRetry,
  showPrs,
  markInUse,
  showUpstream,
  projectPath,
  projectId,
  onSelectPr,
}: BranchPrPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>('branch');
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<number | null>(null);
  // Tracks which PR (if any) the current selection came from, so the trigger
  // can show a status-colored "PR #n" badge. Cleared whenever a plain branch
  // is chosen.
  const [pickedPr, setPickedPr] = useState<{
    number: number;
    head: string;
    state: PullRequestState;
  } | null>(null);

  const fetchPrs = useCallback(async () => {
    setPrLoading(true);
    setPrError(null);
    try {
      if (!projectId) {
        setPrs([]);
        return;
      }
      const resp = await window.electronAPI.prListOpen({ projectId, cwd: projectPath });
      if (resp.success && resp.data) setPrs(resp.data);
      else setPrError(resp.error || 'Failed to load pull requests');
    } catch (err) {
      setPrError(String(err));
    } finally {
      setPrLoading(false);
    }
  }, [projectPath, projectId]);

  // Fetch PRs the first time the popover opens (not gated on the PR tab) so the
  // tab count is populated up front and switching to the PR tab is instant.
  useEffect(() => {
    if (open && showPrs && prs === null && !prLoading) void fetchPrs();
  }, [open, showPrs, prs, prLoading, fetchPrs]);

  function chooseBranch(b: BranchInfo) {
    setPickedPr(null);
    onSelectBranch(b);
    setOpen(false);
  }

  async function choosePr(pr: PullRequest) {
    setPreparingId(pr.number);
    setPrError(null);
    try {
      if (!projectId) return;
      const resp = await window.electronAPI.prPrepareBranch({
        projectId,
        cwd: projectPath,
        number: pr.number,
        headRefName: pr.headRefName,
      });
      if (resp.success && resp.data) {
        setPickedPr({ number: pr.number, head: resp.data.branch, state: pr.state });
        onSelectPr(resp.data.branch, pr.title, resp.data.checkedOut);
        setOpen(false);
      } else {
        setPrError(resp.error || 'Failed to prepare PR branch');
      }
    } catch (err) {
      setPrError(String(err));
    } finally {
      setPreparingId(null);
    }
  }

  // Branch fetch failure replaces the control with a retry affordance, matching
  // the prior behavior — a worktree can't be created without a branch.
  if (branchError) {
    return (
      <Notice icon={<AlertCircle size={14} strokeWidth={1.8} />}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{branchError}</span>
          <TextLink onClick={onRetry}>Retry</TextLink>
        </span>
      </Notice>
    );
  }

  const badgePr = pickedPr && selectedBranch?.name === pickedPr.head ? pickedPr : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SelectTrigger disabled={branchLoading}>
          {branchLoading ? (
            <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon" />
          ) : (
            <GitBranch size={14} strokeWidth={1.8} className="text-icon" />
          )}
          {selectedBranch ? (
            <span className="min-w-0 flex-1 truncate text-left">{selectedBranch.name}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-ink-3">
              {branchLoading ? 'Fetching branches…' : 'Select a branch or PR…'}
            </span>
          )}
          {markInUse && !badgePr && selectedBranch?.checkedOut && <InUseBadge />}
          {badgePr && <PrNumberBadge number={badgePr.number} state={badgePr.state} />}
          {selectedBranch?.shortHash && (
            <span className="type-caption tabular-nums">{selectedBranch.shortHash}</span>
          )}
        </SelectTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width)" sideOffset={4}>
        {showPrs && (
          <div className="p-1.5 pb-0">
            <Segmented<PickerTab>
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: 'branch',
                  label: 'Branches',
                  icon: <GitBranch size={14} strokeWidth={1.8} />,
                  count: branches.length,
                },
                {
                  value: 'pr',
                  label: 'Pull requests',
                  icon: <GitPullRequestArrow size={14} strokeWidth={1.8} />,
                  count: prs?.length,
                },
              ]}
            />
          </div>
        )}
        {/* Remount per tab so the search input + active item reset cleanly. */}
        <Command key={tab}>
          <CommandInput
            autoFocus
            placeholder={tab === 'pr' ? 'Search pull requests…' : 'Search branches…'}
          />
          <CommandList>
            {tab === 'branch' && (
              <>
                <CommandEmpty>No branches.</CommandEmpty>
                {branches.map((b) => (
                  <CommandItem key={b.ref} value={b.name} onSelect={() => chooseBranch(b)}>
                    <GitBranch size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {markInUse && b.checkedOut && <InUseBadge />}
                    {showUpstream && b.upstream && b.upstream.ahead > 0 && (
                      <span className="type-caption flex shrink-0 items-center tabular-nums">
                        <ArrowUp size={14} strokeWidth={1.8} className="text-icon" />
                        {b.upstream.ahead}
                      </span>
                    )}
                    {showUpstream && b.upstream && b.upstream.behind > 0 && (
                      <span className="type-caption flex shrink-0 items-center tabular-nums">
                        <ArrowDown size={14} strokeWidth={1.8} className="text-icon" />
                        {b.upstream.behind}
                      </span>
                    )}
                    <span className="type-caption shrink-0 tabular-nums">{b.shortHash}</span>
                  </CommandItem>
                ))}
              </>
            )}

            {tab === 'pr' && (
              <>
                {prLoading && (
                  <div className="type-caption flex items-center justify-center gap-2 py-4">
                    <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon" />
                    Loading pull requests…
                  </div>
                )}
                {prError && !prLoading && (
                  <div className="type-caption flex items-center gap-2 px-2.5 py-3">
                    <AlertCircle size={14} strokeWidth={1.8} className="shrink-0 text-state-fail" />
                    <span className="min-w-0 flex-1 text-state-fail">{prError}</span>
                    <TextLink
                      onClick={() => {
                        setPrs(null);
                        void fetchPrs();
                      }}
                    >
                      Retry
                    </TextLink>
                  </div>
                )}
                {!prLoading && !prError && (
                  <>
                    <CommandEmpty>No open pull requests.</CommandEmpty>
                    {prs?.map((pr) => (
                      <CommandItem
                        key={pr.number}
                        value={`${pr.number} ${pr.title} ${pr.headRefName}`}
                        disabled={preparingId !== null}
                        onSelect={() => void choosePr(pr)}
                      >
                        <GitPullRequestArrow
                          size={14}
                          strokeWidth={1.8}
                          className={cn('shrink-0', prStatusText(pr.state))}
                        />
                        <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                        <span className="type-caption flex max-w-40 min-w-0 shrink-0 items-center gap-1">
                          <span className="truncate">{pr.headRefName}</span>
                          {pr.baseRefName && (
                            <>
                              <ArrowRight
                                size={14}
                                strokeWidth={1.8}
                                className="shrink-0 text-icon"
                              />
                              <span className="truncate">{pr.baseRefName}</span>
                            </>
                          )}
                        </span>
                        {preparingId === pr.number ? (
                          <Loader2
                            size={14}
                            strokeWidth={1.8}
                            className="shrink-0 animate-spin text-icon"
                          />
                        ) : (
                          <span className="type-caption shrink-0 tabular-nums">#{pr.number}</span>
                        )}
                      </CommandItem>
                    ))}
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A branch already checked out elsewhere: a neutral tag (colour is for agent
 *  state; picking it is allowed, the task then shares that checkout). */
function InUseBadge() {
  return (
    <Badge size="sm" title="Checked out in another worktree">
      In use
    </Badge>
  );
}
