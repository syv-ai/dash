import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  GitBranch,
  Zap,
  ChevronDown,
  Loader2,
  AlertCircle,
  Search,
  Upload,
  FolderGit2,
} from 'lucide-react';
import { SearchableMultiSelect } from './SearchableMultiSelect';
import type { BranchInfo, GithubIssue, AzureDevOpsWorkItem, LinkedItem } from '../../shared/types';
import { isAdoRemote } from '../../shared/urls';

export interface CreateTaskOptions {
  name: string;
  useWorktree: boolean;
  autoApprove: boolean;
  baseRef?: string;
  pushRemote?: boolean;
  linkedItems?: LinkedItem[];
}

interface TaskModalProps {
  projectPath: string;
  projectId?: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  onClose: () => void;
  onCreate: (options: CreateTaskOptions) => void;
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

export function TaskModal({
  projectPath,
  projectId,
  isGitRepo,
  gitRemote,
  onClose,
  onCreate,
  onGitInit,
}: TaskModalProps) {
  const [name, setName] = useState('');
  const [gitReady, setGitReady] = useState(isGitRepo);
  const [useWorktree, setUseWorktree] = useState(isGitRepo);
  const [autoApprove, setAutoApprove] = useState(() => localStorage.getItem('yoloMode') === 'true');
  const [pushRemote, setPushRemote] = useState(true);
  const [gitInitLoading, setGitInitLoading] = useState(false);

  // Branch selector state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchInfo | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Issue/work item selection — show only the provider matching the remote
  const isAdo = isAdoRemote(gitRemote);
  const [ghAvailable, setGhAvailable] = useState(false);
  const [adoAvailable, setAdoAvailable] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<GithubIssue[]>([]);
  const [selectedWorkItems, setSelectedWorkItems] = useState<AzureDevOpsWorkItem[]>([]);

  const showGithub = !isAdo && ghAvailable;
  const showAdo = isAdo && adoAvailable;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Check availability only for the provider matching the remote
  useEffect(() => {
    if (isAdo) {
      window.electronAPI.adoCheckConfigured(projectId).then((resp) => {
        if (resp.success && resp.data) setAdoAvailable(true);
      });
    } else if (gitRemote) {
      window.electronAPI.githubCheckAvailable().then((resp) => {
        if (resp.success && resp.data) setGhAvailable(true);
      });
    }
  }, [isAdo, gitRemote, projectId]);

  // Fetch branches when worktree is enabled
  useEffect(() => {
    if (useWorktree) fetchBranches();
  }, [useWorktree, projectPath]);

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
          setSelectedBranch(resp.data[0]);
        }
      } else {
        setBranchError(resp.error || 'Failed to load branches');
      }
    } catch (err) {
      setBranchError(String(err));
    } finally {
      setBranchLoading(false);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      const baseRef = useWorktree ? selectedBranch?.ref : undefined;

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

      onCreate({
        name: name.trim(),
        useWorktree,
        autoApprove,
        baseRef,
        pushRemote: useWorktree ? pushRemote : undefined,
        linkedItems: allLinkedItems.length > 0 ? allLinkedItems : undefined,
      });
      onClose();
    }
  }

  function slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[420px] animate-slide-up overflow-visible"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 rounded-t-xl"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <h2 className="text-[14px] font-semibold text-foreground">New Task</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
              autoFocus
            />
          </div>

          {/* Worktree toggle */}
          {gitReady ? (
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={useWorktree}
                    onChange={(e) => setUseWorktree(e.target.checked)}
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
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-1 border border-border/40">
              <FolderGit2 size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
              <span className="text-[12px] text-muted-foreground/60 flex-1">
                Not a git repository
              </span>
              <button
                type="button"
                onClick={handleGitInit}
                disabled={gitInitLoading}
                className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                {gitInitLoading ? 'Initializing...' : 'Initialize Git'}
              </button>
            </div>
          )}

          {/* Branch selector */}
          {useWorktree && (
            <div className="mb-4" ref={dropdownRef}>
              <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                Base branch
              </label>

              {branchError ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
                  <AlertCircle size={13} strokeWidth={2} />
                  <span className="flex-1 truncate">{branchError}</span>
                  <button
                    type="button"
                    onClick={fetchBranches}
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
            </div>
          )}

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

          {/* Push remote branch toggle */}
          {useWorktree && (
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

          {/* Yolo mode toggle */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => {
                    setAutoApprove(e.target.checked);
                    localStorage.setItem('yoloMode', String(e.target.checked));
                  }}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] rounded-full bg-accent peer-checked:bg-primary/80 transition-colors duration-200" />
                <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-muted-foreground/40 peer-checked:bg-primary-foreground peer-checked:translate-x-[14px] transition-all duration-200" />
              </div>
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-muted-foreground/40" strokeWidth={1.8} />
                <span className="text-[13px] text-foreground/80">Yolo mode</span>
                <span className="text-[11px] text-muted-foreground/40">skip permissions</span>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
