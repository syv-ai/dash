import React, { useState, useEffect, useRef } from 'react';
import { X, GitBranch, Zap, ChevronDown, Loader2, AlertCircle, Search } from 'lucide-react';
import type { BranchInfo } from '../../shared/types';

interface TaskModalProps {
  projectPath: string;
  onClose: () => void;
  onCreate: (name: string, useWorktree: boolean, autoApprove: boolean, baseRef?: string) => void;
}

export function TaskModal({ projectPath, onClose, onCreate }: TaskModalProps) {
  const [name, setName] = useState('');
  const [useWorktree, setUseWorktree] = useState(true);
  const [autoApprove, setAutoApprove] = useState(() => localStorage.getItem('yoloMode') === 'true');

  // Branch selector state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchInfo | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch branches when worktree is enabled
  useEffect(() => {
    if (useWorktree) {
      fetchBranches();
    }
  }, [useWorktree, projectPath]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      searchInputRef.current?.focus();
    }
  }, [dropdownOpen]);

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

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(branchSearch.toLowerCase()),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      const baseRef = useWorktree ? selectedBranch?.ref : undefined;
      onCreate(name.trim(), useWorktree, autoApprove, baseRef);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[420px] animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60"
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

          {/* Branch selector — animated collapse */}
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: useWorktree ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
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
                    <button
                      type="button"
                      onClick={() => !branchLoading && setDropdownOpen((v) => !v)}
                      disabled={branchLoading}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-[13px] text-left hover:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 disabled:opacity-50"
                    >
                      {branchLoading ? (
                        <>
                          <Loader2 size={13} className="animate-spin text-muted-foreground/50" />
                          <span className="text-muted-foreground/50">Fetching branches...</span>
                        </>
                      ) : selectedBranch ? (
                        <>
                          <GitBranch
                            size={12}
                            className="text-muted-foreground/50 shrink-0"
                            strokeWidth={1.8}
                          />
                          <span className="flex-1 truncate text-foreground">
                            {selectedBranch.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground/40 font-mono shrink-0">
                            {selectedBranch.shortHash}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/30">Select branch...</span>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-muted-foreground/40 shrink-0 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Dropdown */}
                    {dropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full bg-card border border-border/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
                        {/* Search */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
                          <Search size={12} className="text-muted-foreground/40 shrink-0" />
                          <input
                            ref={searchInputRef}
                            type="text"
                            value={branchSearch}
                            onChange={(e) => setBranchSearch(e.target.value)}
                            placeholder="Filter branches..."
                            className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/30 outline-none"
                          />
                        </div>

                        {/* Branch list */}
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
            </div>
          </div>

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
