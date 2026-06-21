import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  GitBranch,
  ChevronDown,
  Loader2,
  AlertCircle,
  Search,
  Upload,
  FolderGit2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { SearchableMultiSelect } from '../ui/SearchableMultiSelect';
import type {
  BranchInfo,
  GithubIssue,
  AzureDevOpsWorkItem,
  LinkedItem,
  PermissionMode,
} from '../../../shared/types';
import { isAdoRemote } from '../../../shared/urls';
import { slugify } from '../../../shared/slug';
import { Modal, useModalClose } from '../ui/Modal';
import { PermissionModePicker, readInitialPermissionMode } from './PermissionModePicker';
import { getTaskCreatability } from './taskModalCreatability';
import { Expandable } from '../ui/Expandable';
import { PrQuickStart } from './PrQuickStart';

/**
 * Task creation modes. Each variant carries only the fields that are meaningful
 * for that mode — `baseRef` is a full ref (`origin/main`) for new-branch worktree
 * creation; `branch` is a plain branch name for existing-branch flows. The
 * discriminator stops impossible combinations (e.g. `pushRemote` on a non-worktree
 * task) from reaching the create handler.
 */
export type CreateTaskOptions = {
  name: string;
  permissionMode: PermissionMode;
  linkedItems?: LinkedItem[];
  contextPrompt?: string;
  /** Per-task worktree scripts (newline-separated), snapshotted from the project
   *  default and editable per task. Only meaningful for worktree tasks. */
  setupScript?: string | null;
  teardownScript?: string | null;
} & (
  | { kind: 'worktree-new-branch'; baseRef: string; pushRemote: boolean }
  | { kind: 'worktree-existing'; branch: string }
  | { kind: 'in-place-checkout'; branch: string }
  | { kind: 'in-place-no-git' }
);

/** Project-level prefill for the New Task fields, loaded from .dash/config.json.
 *  Prefill only — sets each field's default value; the user can still change it. */
export interface TaskModalDefaults {
  baseRef?: string;
  permissionMode?: PermissionMode;
  useWorktree?: boolean;
  contextPrompt?: string;
}

interface TaskModalProps {
  projectPath: string;
  projectId?: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  existingNonWorktreeTask?: { id: string; name: string } | null;
  /** Pre-resolved at App-level so the issue picker + branch banner render at
   *  their final size on first paint, avoiding a visible "settle" as the modal grows. */
  ghAvailable: boolean;
  adoConfigured: boolean;
  initialBranches?: BranchInfo[];
  taskDefaults?: TaskModalDefaults | null;
  /** Project default worktree scripts (newline-separated), prefilled into the
   *  per-task override fields. */
  defaultScripts?: { setup: string; teardown: string } | null;
  onClose: () => void;
  onCreate: (options: CreateTaskOptions) => Promise<boolean>;
  onGitInit?: () => void;
}

export function TaskModal(props: TaskModalProps) {
  return (
    <Modal onClose={props.onClose} size="w-[760px]" overflow="visible">
      <TaskModalBody
        projectPath={props.projectPath}
        projectId={props.projectId}
        isGitRepo={props.isGitRepo}
        gitRemote={props.gitRemote}
        existingNonWorktreeTask={props.existingNonWorktreeTask}
        ghAvailable={props.ghAvailable}
        adoConfigured={props.adoConfigured}
        initialBranches={props.initialBranches}
        taskDefaults={props.taskDefaults}
        defaultScripts={props.defaultScripts}
        onCreate={props.onCreate}
        onGitInit={props.onGitInit}
      />
    </Modal>
  );
}

interface TaskModalBodyProps {
  projectPath: string;
  projectId?: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  existingNonWorktreeTask?: { id: string; name: string } | null;
  ghAvailable: boolean;
  adoConfigured: boolean;
  initialBranches?: BranchInfo[];
  taskDefaults?: TaskModalDefaults | null;
  defaultScripts?: { setup: string; teardown: string } | null;
  onCreate: (options: CreateTaskOptions) => Promise<boolean>;
  onGitInit?: () => void;
}

function GithubIssueRow({ issue }: { issue: GithubIssue }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">
          #{issue.number}
        </span>
        <span className="text-[12px] text-foreground/80 truncate">{issue.title}</span>
      </div>
      {issue.labels.length > 0 && (
        <div className="flex gap-1 mt-0.5 flex-wrap">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 rounded text-[9px] bg-accent/60 text-muted-foreground/60"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function AdoWorkItemRow({ item }: { item: AzureDevOpsWorkItem }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">#{item.id}</span>
        <span className="text-[12px] text-foreground/80 truncate">{item.title}</span>
      </div>
      <div className="flex gap-1 mt-0.5 flex-wrap">
        <span className="px-1.5 py-0.5 rounded text-[9px] bg-accent/60 text-muted-foreground/60">
          {item.type}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[9px] bg-accent/60 text-muted-foreground/60">
          {item.state}
        </span>
        {item.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded text-[9px] bg-accent/60 text-muted-foreground/60"
          >
            {tag}
          </span>
        ))}
      </div>
    </>
  );
}

function TaskModalBody({
  projectPath,
  projectId,
  isGitRepo,
  gitRemote,
  existingNonWorktreeTask,
  ghAvailable,
  adoConfigured,
  initialBranches,
  taskDefaults,
  defaultScripts,
  onCreate,
  onGitInit,
}: TaskModalBodyProps) {
  const close = useModalClose();
  const [name, setName] = useState('');
  const [gitReady, setGitReady] = useState(isGitRepo);
  const worktreeForced = !!existingNonWorktreeTask;
  const [useWorktree, setUseWorktree] = useState(
    taskDefaults?.useWorktree ?? (isGitRepo || worktreeForced),
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () => taskDefaults?.permissionMode ?? readInitialPermissionMode(),
  );
  const [contextPrompt, setContextPrompt] = useState(taskDefaults?.contextPrompt ?? '');
  // Per-task worktree scripts, prefilled from the project default; edit to
  // override for just this worktree.
  const [setupScript, setSetupScript] = useState(defaultScripts?.setup ?? '');
  const [teardownScript, setTeardownScript] = useState(defaultScripts?.teardown ?? '');
  const [pushRemote, setPushRemote] = useState(true);
  const [gitInitLoading, setGitInitLoading] = useState(false);
  const [createNewBranch, setCreateNewBranch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Seeded from App-level cache when available so the status banner renders
  // at its final height on first paint.
  const [branches, setBranches] = useState<BranchInfo[]>(initialBranches ?? []);
  const [branchLoading, setBranchLoading] = useState(false);
  // True once a branch fetch has resolved (or branches were preloaded), so an
  // empty branch list can be trusted to mean "repo has no commits yet".
  const [branchFetchDone, setBranchFetchDone] = useState((initialBranches?.length ?? 0) > 0);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchInfo | null>(() => {
    const list = initialBranches ?? [];
    if (taskDefaults?.baseRef) {
      const match = list.find(
        (b) => b.ref === taskDefaults.baseRef || b.name === taskDefaults.baseRef,
      );
      if (match) return match;
    }
    return list[0] ?? null;
  });
  const [branchSearch, setBranchSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Issue/work item selection — show only the provider matching the remote
  const isAdo = isAdoRemote(gitRemote);
  const [selectedIssues, setSelectedIssues] = useState<GithubIssue[]>([]);
  const [selectedWorkItems, setSelectedWorkItems] = useState<AzureDevOpsWorkItem[]>([]);

  const showGithub = !isAdo && !!gitRemote && ghAvailable;
  const showAdo = isAdo && adoConfigured;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fall back to fetching here when App couldn't pre-fetch — either the modal
  // opened before App's effect settled, or git was just initialized in this modal.
  useEffect(() => {
    if (gitReady && branches.length === 0) void fetchBranches();
  }, [gitReady, projectPath]);

  // Close branch dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when branch dropdown opens
  useEffect(() => {
    if (dropdownOpen) searchInputRef.current?.focus();
  }, [dropdownOpen]);

  // Search callbacks for SearchableMultiSelect
  const searchGithubIssues = useCallback(
    (query: string) => window.electronAPI.githubSearchIssues(projectPath, query),
    [projectPath],
  );

  const searchAdoWorkItems = useCallback(
    (query: string) => window.electronAPI.adoSearchWorkItems(query, projectId),
    [projectId],
  );

  async function fetchBranches() {
    setBranchLoading(true);
    setBranchError(null);
    try {
      const resp = await window.electronAPI.gitListBranches(projectPath);
      if (resp.success && resp.data) {
        setBranches(resp.data);
        if (!selectedBranch && resp.data.length > 0) {
          setSelectedBranch(resp.data[0]!);
        }
      } else {
        setBranchError(resp.error || 'Failed to load branches');
      }
    } catch (err) {
      setBranchError(String(err));
    } finally {
      setBranchLoading(false);
      setBranchFetchDone(true);
    }
  }

  async function handleGitInit() {
    setGitInitLoading(true);
    try {
      const resp = await window.electronAPI.gitInit(projectPath);
      if (resp.success) {
        setGitReady(true);
        setUseWorktree(true);
        onGitInit?.();
      }
    } finally {
      setGitInitLoading(false);
    }
  }

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(branchSearch.toLowerCase()),
  );

  // A fresh git repo (no commits/branches) can't host a worktree and has no
  // branch to select — surface it as an in-place task instead of dead-ending
  // the disabled "Create Task" button.
  const { repoHasNoCommits, requiresBranchSelection } = getTaskCreatability({
    gitReady,
    branchFetchDone,
    branchError: !!branchError,
    branchCount: branches.length,
    hasSelectedBranch: !!selectedBranch,
  });

  // From-PR quick start: the PR head has already been fetched to `branch`.
  // Set up the modal so the normal worktree-existing create path runs on it,
  // and prefill the name from the PR title if the user hasn't typed one.
  function handlePrPrepared(branch: string, prTitle: string) {
    setUseWorktree(true);
    setCreateNewBranch(false);
    const prBranch: BranchInfo = { name: branch, ref: branch, shortHash: '', relativeDate: '' };
    setBranches((prev) => (prev.some((b) => b.name === branch) ? prev : [prBranch, ...prev]));
    setSelectedBranch(prBranch);
    if (!name.trim()) setName(prTitle.slice(0, 60));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || isCreating) return;

    // Build unified linkedItems from both providers
    const ghItems: LinkedItem[] = selectedIssues.map((issue) => ({
      provider: 'github' as const,
      id: issue.number,
      title: issue.title,
      url: issue.url,
      labels: issue.labels.length > 0 ? issue.labels : undefined,
      body: issue.body || undefined,
    }));
    const adoItems: LinkedItem[] = selectedWorkItems.map((wi) => ({
      provider: 'ado' as const,
      id: wi.id,
      title: wi.title,
      url: wi.url,
      type: wi.type,
      state: wi.state,
      tags: wi.tags,
      description: wi.description,
      acceptanceCriteria: wi.acceptanceCriteria,
      parents: wi.parents,
    }));
    const allLinkedItems: LinkedItem[] = [...ghItems, ...adoItems];
    const linkedItems = allLinkedItems.length > 0 ? allLinkedItems : undefined;

    // Per-task scripts only apply to worktree tasks; persist null otherwise.
    const scriptsApply = useWorktree && !repoHasNoCommits;
    const base = {
      name: name.trim(),
      permissionMode,
      linkedItems,
      contextPrompt: contextPrompt.trim() || undefined,
      setupScript: scriptsApply ? setupScript : null,
      teardownScript: scriptsApply ? teardownScript : null,
    };

    let options: CreateTaskOptions;
    if (repoHasNoCommits) {
      // No commits yet → run in the project dir; worktrees need a base commit.
      options = { ...base, kind: 'in-place-no-git' };
    } else if (useWorktree) {
      if (createNewBranch && selectedBranch) {
        options = { ...base, kind: 'worktree-new-branch', baseRef: selectedBranch.ref, pushRemote };
      } else if (selectedBranch) {
        options = { ...base, kind: 'worktree-existing', branch: selectedBranch.name };
      } else {
        return; // Submit was gated by the disabled check; defensive.
      }
    } else if (gitReady && selectedBranch) {
      options = { ...base, kind: 'in-place-checkout', branch: selectedBranch.name };
    } else {
      options = { ...base, kind: 'in-place-no-git' };
    }

    setIsCreating(true);
    try {
      const ok = await onCreate(options);
      if (ok) close();
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40 rounded-t-xl">
        <h2 className="text-[14px] font-semibold text-foreground">New Task</h2>
        <button
          onClick={close}
          disabled={isCreating}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="p-5"
      >
        <div className="grid grid-cols-2 gap-x-6">
          {/* ── Left column: core settings ── */}
          <div className="min-w-0">
            {/* Task name */}
            <div className="mb-5">
              <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                Task name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fix auth bug, Add dark mode..."
                maxLength={60}
                className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
                autoFocus
              />
            </div>

            {/* Worktree toggle */}
            {gitReady && repoHasNoCommits ? (
              <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[hsl(var(--surface-1))]">
                <FolderGit2
                  size={13}
                  className="text-muted-foreground/25 mt-0.5 flex-shrink-0"
                  strokeWidth={1.8}
                />
                <span className="text-[12px] text-muted-foreground/45">
                  No commits yet — this task runs in the project folder. Make an initial commit to
                  enable worktrees and branches.
                </span>
              </div>
            ) : gitReady ? (
              <div className="mb-4">
                <label
                  className={`flex items-center gap-3 group ${worktreeForced ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={useWorktree}
                      onChange={(e) => {
                        if (!worktreeForced) setUseWorktree(e.target.checked);
                      }}
                      disabled={worktreeForced}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                    <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
                  </div>
                  <div className="flex items-center gap-2">
                    <GitBranch size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                    <span className="text-[13px] text-foreground/80">Git worktree</span>
                    <span className="text-[11px] text-muted-foreground/40">isolated branch</span>
                  </div>
                </label>
                {worktreeForced && (
                  <p className="ml-[44px] mt-1 text-[11px] text-muted-foreground/50">
                    A non-worktree task already exists:{' '}
                    <span className="font-medium text-foreground/60">
                      {existingNonWorktreeTask.name}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[hsl(var(--surface-1))] border border-border/40">
                <FolderGit2 size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                <span className="text-[12px] text-muted-foreground/60 flex-1">
                  Not a git repository
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void handleGitInit();
                  }}
                  disabled={gitInitLoading}
                  className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                >
                  {gitInitLoading ? 'Initializing...' : 'Initialize Git'}
                </button>
              </div>
            )}

            {/* Use existing branch toggle */}
            {useWorktree && !repoHasNoCommits && (
              <div className="mb-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={createNewBranch}
                      onChange={(e) => {
                        setCreateNewBranch(e.target.checked);
                        setSelectedBranch(null);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                    <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
                  </div>
                  <div className="flex items-center gap-2">
                    <GitBranch size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                    <span className="text-[13px] text-foreground/80">Create new branch</span>
                  </div>
                </label>
              </div>
            )}

            {/* Branch selector */}
            {gitReady && !repoHasNoCommits && (
              <div className="mb-4" ref={dropdownRef}>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                  {useWorktree && createNewBranch ? 'Base branch' : 'Branch'}
                </label>

                {branchError ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
                    <AlertCircle size={13} strokeWidth={2} />
                    <span className="flex-1 truncate">{branchError}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void fetchBranches();
                      }}
                      className="text-[11px] font-medium underline underline-offset-2 hover:no-underline shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring/50 transition-all duration-150">
                      {branchLoading ? (
                        <Loader2
                          size={12}
                          className="animate-spin text-muted-foreground/50 shrink-0"
                        />
                      ) : (
                        <GitBranch
                          size={12}
                          className="text-muted-foreground/40 shrink-0"
                          strokeWidth={1.8}
                        />
                      )}
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={dropdownOpen ? branchSearch : selectedBranch?.name || ''}
                        onChange={(e) => {
                          setBranchSearch(e.target.value);
                          if (!dropdownOpen) setDropdownOpen(true);
                        }}
                        onFocus={() => {
                          setBranchSearch('');
                          setDropdownOpen(true);
                        }}
                        placeholder={branchLoading ? 'Fetching branches...' : 'Search branches...'}
                        disabled={branchLoading}
                        className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/30 outline-none disabled:opacity-50"
                      />
                      {selectedBranch && !dropdownOpen && (
                        <span className="text-[11px] text-muted-foreground/40 font-mono shrink-0">
                          {selectedBranch.shortHash}
                        </span>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-muted-foreground/40 shrink-0 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </div>

                    {dropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full bg-card border border-border/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
                        <div className="max-h-[200px] overflow-y-auto">
                          {filteredBranches.length === 0 ? (
                            <div className="px-3 py-3 text-[12px] text-muted-foreground/40 text-center">
                              No branches found
                            </div>
                          ) : (
                            filteredBranches.map((branch) => (
                              <button
                                key={branch.ref}
                                type="button"
                                onClick={() => {
                                  setSelectedBranch(branch);
                                  setDropdownOpen(false);
                                  setBranchSearch('');
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/60 transition-colors duration-100 ${
                                  selectedBranch?.ref === branch.ref ? 'bg-accent/40' : ''
                                }`}
                              >
                                <GitBranch
                                  size={11}
                                  className="text-muted-foreground/40 shrink-0"
                                  strokeWidth={1.8}
                                />
                                <span className="flex-1 truncate text-[12px] text-foreground/80">
                                  {branch.name}
                                </span>
                                {branch.upstream && branch.upstream.ahead > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-500 font-mono shrink-0">
                                    <ArrowUp size={9} strokeWidth={2.5} />
                                    {branch.upstream.ahead}
                                  </span>
                                )}
                                {branch.upstream && branch.upstream.behind > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-mono shrink-0">
                                    <ArrowDown size={9} strokeWidth={2.5} />
                                    {branch.upstream.behind}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
                                  {branch.shortHash}
                                </span>
                                <span className="text-[10px] text-muted-foreground/30 shrink-0">
                                  {branch.relativeDate}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Branch status banner */}
                {selectedBranch &&
                  !dropdownOpen &&
                  !branchError &&
                  (() => {
                    const behind = selectedBranch.upstream?.behind ?? 0;
                    const ahead = selectedBranch.upstream?.ahead ?? 0;
                    const isDirectCheckout = !createNewBranch || !useWorktree;

                    if (behind > 0 && isDirectCheckout) {
                      return (
                        <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px]">
                          <ArrowDown
                            size={12}
                            strokeWidth={2}
                            className="text-amber-500 shrink-0 mt-0.5"
                          />
                          <span className="text-amber-200/80">
                            <span className="font-medium text-amber-500">
                              {behind} commit{behind !== 1 ? 's' : ''} behind
                            </span>{' '}
                            remote. The local state of this branch will be used.
                          </span>
                        </div>
                      );
                    }
                    if (behind > 0) {
                      return (
                        <p className="mt-1.5 text-[11px] text-muted-foreground/50">
                          Base branch is{' '}
                          <span className="text-amber-500 font-medium">
                            {behind} commit{behind !== 1 ? 's' : ''} behind
                          </span>{' '}
                          remote
                          {ahead > 0 && (
                            <>
                              {', '}
                              <span className="text-emerald-500 font-medium">{ahead} ahead</span>
                            </>
                          )}
                        </p>
                      );
                    }
                    if (ahead > 0) {
                      return (
                        <p className="mt-1.5 text-[11px] text-muted-foreground/50">
                          <span className="text-emerald-500 font-medium">
                            {ahead} commit{ahead !== 1 ? 's' : ''} ahead
                          </span>{' '}
                          of remote
                        </p>
                      );
                    }
                    return null;
                  })()}
              </div>
            )}

            <div className="mb-4">
              <PermissionModePicker
                value={permissionMode}
                onChange={(v) => {
                  setPermissionMode(v);
                  localStorage.setItem('permissionMode', v);
                }}
              />
            </div>
          </div>

          {/* ── Right column: content & details ── */}
          <div className="min-w-0">
            {/* Context prompt (optional) */}
            <div className="mb-5">
              <Expandable
                label="Context prompt"
                hint="optional"
                defaultOpen={!!contextPrompt.trim()}
              >
                <textarea
                  value={contextPrompt}
                  onChange={(e) => setContextPrompt(e.target.value)}
                  rows={2}
                  placeholder="Prepended to the task's context — e.g. coding conventions, links."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
                />
              </Expandable>
            </div>

            {/* Issue/Work Item pickers */}
            {(showGithub || showAdo) && (
              <div className="mb-4">
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                  <span className="flex items-center gap-1.5">
                    <Search size={12} strokeWidth={1.8} />
                    {showGithub && showAdo
                      ? 'Link issues / work items'
                      : showAdo
                        ? 'Link work items'
                        : 'Link issues'}
                    <span className="text-muted-foreground/40 font-normal">optional</span>
                  </span>
                </label>

                {showGithub && (
                  <SearchableMultiSelect<GithubIssue>
                    onSearch={searchGithubIssues}
                    selected={selectedIssues}
                    onSelect={setSelectedIssues}
                    getKey={(i) => i.number}
                    getLabel={(i) => `#${i.number}`}
                    renderItem={(issue) => <GithubIssueRow issue={issue} />}
                    placeholder="Search GitHub issues..."
                  />
                )}

                {showAdo && (
                  <SearchableMultiSelect<AzureDevOpsWorkItem>
                    onSearch={searchAdoWorkItems}
                    selected={selectedWorkItems}
                    onSelect={setSelectedWorkItems}
                    getKey={(i) => i.id}
                    getLabel={(i) => `#${i.id}`}
                    renderItem={(item) => <AdoWorkItemRow item={item} />}
                    placeholder="Search work items..."
                  />
                )}
              </div>
            )}

            {/* From-PR quick start: check out an open PR's head branch */}
            {(showGithub || showAdo) && gitReady && !repoHasNoCommits && (
              <PrQuickStart
                provider={showAdo ? 'ado' : 'github'}
                projectPath={projectPath}
                projectId={projectId}
                gitRemote={gitRemote}
                onPrepared={handlePrPrepared}
              />
            )}

            {/* Push remote branch toggle */}
            {useWorktree && createNewBranch && (
              <div className="mb-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={pushRemote}
                      onChange={(e) => setPushRemote(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                    <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Upload size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                    <span className="text-[13px] text-foreground/80">Push remote branch</span>
                  </div>
                </label>
                {pushRemote && name.trim() && (
                  <p className="ml-[44px] mt-1 text-[11px] text-muted-foreground/40 font-mono truncate">
                    origin/{slugify(name.trim())}
                  </p>
                )}
              </div>
            )}

            {/* Per-task worktree scripts (override the project default) */}
            {useWorktree && !repoHasNoCommits && (
              <div className="mb-4">
                <Expandable label="Worktree scripts" hint="setup / teardown" defaultOpen={false}>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground/60 mb-1.5">
                        Setup — runs in this new worktree
                      </label>
                      <textarea
                        value={setupScript}
                        onChange={(e) => setSetupScript(e.target.value)}
                        rows={3}
                        placeholder={'pnpm install\ncp ../.env .env'}
                        className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground/60 mb-1.5">
                        Teardown — runs before this worktree is removed
                      </label>
                      <textarea
                        value={teardownScript}
                        onChange={(e) => setTeardownScript(e.target.value)}
                        rows={2}
                        placeholder={'docker compose down'}
                        className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
                      Prefilled from the project default. Edits apply to this worktree only.
                    </p>
                  </div>
                </Expandable>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 justify-end">
          <button
            type="button"
            onClick={close}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              !name.trim() ||
              isCreating ||
              // Block submit when git is ready but no branch is selected (e.g.
              // branch fetch failed). Otherwise we'd silently create the task
              // on whatever branch the project happens to be on. Waived for a
              // commitless repo, which legitimately has no branch to select.
              requiresBranchSelection
            }
            className="px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 flex items-center gap-2"
          >
            {isCreating && <Loader2 size={14} className="animate-spin" />}
            {isCreating ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </form>
    </>
  );
}
