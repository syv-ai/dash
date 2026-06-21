import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GitPullRequest, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import type { PullRequest } from '../../../shared/types';

interface PrQuickStartProps {
  provider: 'github' | 'ado';
  projectPath: string;
  projectId?: string;
  gitRemote: string | null;
  /** Called once the PR head has been fetched into `branch`. */
  onPrepared: (branch: string, prTitle: string) => void;
}

export function PrQuickStart({
  provider,
  projectPath,
  projectId,
  gitRemote,
  onPrepared,
}: PrQuickStartProps) {
  const [open, setOpen] = useState(false);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchPrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp =
        provider === 'ado'
          ? await window.electronAPI.adoListPrs(gitRemote ?? '', projectId)
          : await window.electronAPI.githubListPrs(projectPath);
      if (resp.success && resp.data) setPrs(resp.data);
      else setError(resp.error || 'Failed to load pull requests');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [provider, projectPath, projectId, gitRemote]);

  // Lazy fetch: only hit gh/ADO the first time the dropdown is opened.
  useEffect(() => {
    if (open && prs === null && !loading) void fetchPrs();
  }, [open, prs, loading, fetchPrs]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function selectPr(pr: PullRequest) {
    setPreparingId(pr.number);
    setError(null);
    try {
      const resp =
        provider === 'ado'
          ? await window.electronAPI.adoPreparePrBranch(projectPath, pr.headRefName)
          : await window.electronAPI.githubPreparePrBranch(projectPath, pr.number, pr.headRefName);
      if (resp.success && resp.data) {
        onPrepared(resp.data.branch, pr.title);
        setOpen(false);
      } else {
        setError(resp.error || 'Failed to prepare PR branch');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setPreparingId(null);
    }
  }

  return (
    <div className="mb-4" ref={containerRef}>
      <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
        <span className="flex items-center gap-1.5">
          <GitPullRequest size={12} strokeWidth={1.8} />
          Start from a pull request
          <span className="text-muted-foreground/40 font-normal">optional</span>
        </span>
      </label>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-left hover:border-input transition-colors duration-150"
        >
          <GitPullRequest
            size={12}
            className="text-muted-foreground/40 shrink-0"
            strokeWidth={1.8}
          />
          <span className="flex-1 text-[13px] text-muted-foreground/50">
            Select an open PR to check out…
          </span>
          <ChevronDown
            size={13}
            className={`text-muted-foreground/40 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
            <div className="max-h-[220px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-4 text-[12px] text-muted-foreground/50">
                  <Loader2 size={12} className="animate-spin" />
                  Loading pull requests…
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-destructive">
                  <AlertCircle size={13} strokeWidth={2} />
                  <span className="flex-1">{error}</span>
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
              ) : prs && prs.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted-foreground/40 text-center">
                  No open pull requests
                </div>
              ) : (
                prs?.map((pr) => (
                  <button
                    key={pr.number}
                    type="button"
                    disabled={preparingId !== null}
                    onClick={() => {
                      void selectPr(pr);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/60 transition-colors duration-100 disabled:opacity-50"
                  >
                    <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">
                      #{pr.number}
                    </span>
                    <span className="flex-1 truncate text-[12px] text-foreground/80">
                      {pr.title}
                    </span>
                    {preparingId === pr.number ? (
                      <Loader2
                        size={11}
                        className="animate-spin text-muted-foreground/50 shrink-0"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 truncate max-w-[120px]">
                        {pr.headRefName}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
