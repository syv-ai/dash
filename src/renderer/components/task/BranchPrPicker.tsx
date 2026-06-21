import React, { useState, useCallback, useEffect } from 'react';
import {
  GitBranch,
  GitPullRequest,
  ChevronDown,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { BranchInfo, PullRequest, PullRequestState } from '../../../shared/types';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '../ui/Command';
import { Segmented } from '../ui/Segmented';
import { prStatusPill, prStatusText } from '../ui/prStatusColors';

type PickerTab = 'branch' | 'pr';

interface BranchPrPickerProps {
  branches: BranchInfo[];
  selectedBranch: BranchInfo | null;
  branchLoading: boolean;
  branchError: string | null;
  onSelectBranch: (b: BranchInfo) => void;
  onRetry: () => void;
  /** Show the "Pull requests" group. False while creating a new branch (you're
   *  choosing a base branch then, not a PR to check out). */
  showPrs: boolean;
  prProvider: 'github' | 'ado';
  projectPath: string;
  projectId?: string;
  gitRemote: string | null;
  /** Fired after the PR head has been fetched into `branch`. */
  onSelectPr: (branch: string, prTitle: string) => void;
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
  prProvider,
  projectPath,
  projectId,
  gitRemote,
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
      const resp =
        prProvider === 'ado'
          ? await window.electronAPI.adoListPrs(gitRemote ?? '', projectId)
          : await window.electronAPI.githubListPrs(projectPath);
      if (resp.success && resp.data) setPrs(resp.data);
      else setPrError(resp.error || 'Failed to load pull requests');
    } catch (err) {
      setPrError(String(err));
    } finally {
      setPrLoading(false);
    }
  }, [prProvider, projectPath, projectId, gitRemote]);

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
      const resp =
        prProvider === 'ado'
          ? await window.electronAPI.adoPreparePrBranch(projectPath, pr.headRefName)
          : await window.electronAPI.githubPreparePrBranch(projectPath, pr.number, pr.headRefName);
      if (resp.success && resp.data) {
        setPickedPr({ number: pr.number, head: resp.data.branch, state: pr.state });
        onSelectPr(resp.data.branch, pr.title);
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
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
        <AlertCircle size={13} strokeWidth={2} />
        <span className="flex-1 truncate">{branchError}</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-[11px] font-medium underline underline-offset-2 hover:no-underline shrink-0"
        >
          Retry
        </button>
      </div>
    );
  }

  const badgePr = pickedPr && selectedBranch?.name === pickedPr.head ? pickedPr : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={branchLoading}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-left transition-all duration-150 data-[state=open]:ring-2 data-[state=open]:ring-ring/30 data-[state=open]:border-ring/50 disabled:opacity-50"
        >
          {branchLoading ? (
            <Loader2 size={12} className="animate-spin text-muted-foreground/50 shrink-0" />
          ) : (
            <GitBranch size={12} className="text-muted-foreground/40 shrink-0" strokeWidth={1.8} />
          )}
          {selectedBranch ? (
            <span className="flex-1 truncate text-[13px] text-foreground font-mono">
              {selectedBranch.name}
            </span>
          ) : (
            <span className="flex-1 truncate text-[13px] text-muted-foreground/40">
              {branchLoading ? 'Fetching branches…' : 'Select a branch or PR…'}
            </span>
          )}
          {badgePr && (
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${prStatusPill(badgePr.state)}`}
            >
              PR #{badgePr.number}
            </span>
          )}
          {selectedBranch?.shortHash && (
            <span className="text-[11px] text-muted-foreground/40 font-mono shrink-0">
              {selectedBranch.shortHash}
            </span>
          )}
          <ChevronDown
            size={13}
            className="text-muted-foreground/40 shrink-0 transition-transform duration-150 data-[state=open]:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        sideOffset={5}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
      >
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
                  icon: <GitBranch size={12} strokeWidth={1.8} />,
                  count: branches.length,
                },
                {
                  value: 'pr',
                  label: 'Pull requests',
                  icon: <GitPullRequest size={12} strokeWidth={1.8} />,
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
                    <GitBranch
                      size={11}
                      className="text-muted-foreground/40 shrink-0"
                      strokeWidth={1.8}
                    />
                    <span className="flex-1 truncate font-mono text-foreground/80">{b.name}</span>
                    {b.upstream && b.upstream.ahead > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-emerald-500 font-mono shrink-0">
                        <ArrowUp size={9} strokeWidth={2.5} />
                        {b.upstream.ahead}
                      </span>
                    )}
                    {b.upstream && b.upstream.behind > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-mono shrink-0">
                        <ArrowDown size={9} strokeWidth={2.5} />
                        {b.upstream.behind}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
                      {b.shortHash}
                    </span>
                  </CommandItem>
                ))}
              </>
            )}

            {tab === 'pr' && (
              <>
                {prLoading && (
                  <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-muted-foreground/50">
                    <Loader2 size={12} className="animate-spin" />
                    Loading pull requests…
                  </div>
                )}
                {prError && !prLoading && (
                  <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-destructive">
                    <AlertCircle size={13} strokeWidth={2} />
                    <span className="flex-1">{prError}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPrs(null);
                        void fetchPrs();
                      }}
                      className="text-[11px] font-medium underline underline-offset-2 hover:no-underline shrink-0"
                    >
                      Retry
                    </button>
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
                        <GitPullRequest
                          size={11}
                          className={`${prStatusText(pr.state)} shrink-0`}
                          strokeWidth={1.8}
                        />
                        <span className="flex-1 truncate text-foreground/80">{pr.title}</span>
                        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 truncate max-w-[110px]">
                          {pr.headRefName}
                        </span>
                        {preparingId === pr.number ? (
                          <Loader2
                            size={11}
                            className="animate-spin text-muted-foreground/50 shrink-0"
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
                            #{pr.number}
                          </span>
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
