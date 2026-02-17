import React, { useState, useEffect } from 'react';
import { X, GitCommit, User, Clock, FileText } from 'lucide-react';
import type { CommitDetail as CommitDetailType } from '../../../shared/types';

interface CommitDetailProps {
  detail: CommitDetailType | null;
  loading: boolean;
  open: boolean;
  githubSlug?: string | null;
  onClose: () => void;
  onClosed: () => void;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CommitDetailPanel({ detail, loading, open, githubSlug, onClose, onClosed }: CommitDetailProps) {
  // Trigger enter transition after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const visible = mounted && open;

  return (
    <div
      className="flex-shrink-0 border-l border-border/60 flex flex-col overflow-hidden"
      style={{
        width: visible ? 340 : 0,
        opacity: visible ? 1 : 0,
        transition: 'width 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'width' && !open) onClosed();
      }}
    >
      {/* Inner wrapper with fixed width so content clips instead of reflowing */}
      <div className="flex flex-col flex-1 min-w-[340px] min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-border/60 flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase text-foreground/80 tracking-[0.08em]">
          Details
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {detail && !loading && (
          <div className="flex flex-col gap-4">
            {/* Subject */}
            <p className="text-[13px] font-medium text-foreground leading-snug">
              {detail.commit.subject}
            </p>

            {/* Body */}
            {detail.body && (
              <p className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {detail.body}
              </p>
            )}

            {/* Meta */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <GitCommit size={12} strokeWidth={1.8} className="flex-shrink-0" />
                {githubSlug ? (
                  <a
                    href={`https://github.com/${githubSlug}/commit/${detail.commit.hash}`}
                    className="font-mono text-foreground/80 hover:underline cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      window.electronAPI.openExternal(`https://github.com/${githubSlug}/commit/${detail.commit.hash}`);
                    }}
                  >
                    {detail.commit.hash.slice(0, 12)}
                  </a>
                ) : (
                  <span className="font-mono text-foreground/80">{detail.commit.hash.slice(0, 12)}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <User size={12} strokeWidth={1.8} className="flex-shrink-0" />
                {githubSlug ? (
                  <a
                    href={`https://github.com/${githubSlug}/commits?author=${encodeURIComponent(detail.commit.authorName)}`}
                    className="hover:underline cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      window.electronAPI.openExternal(`https://github.com/${githubSlug}/commits?author=${encodeURIComponent(detail.commit.authorName)}`);
                    }}
                  >
                    {detail.commit.authorName}
                  </a>
                ) : (
                  <span>{detail.commit.authorName}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock size={12} strokeWidth={1.8} />
                <span>{formatFullDate(detail.commit.authorDate)}</span>
              </div>
            </div>

            {/* Stats */}
            {(detail.stats.filesChanged > 0 ||
              detail.stats.additions > 0 ||
              detail.stats.deletions > 0) && (
              <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <FileText size={12} strokeWidth={1.8} />
                  <span>
                    {detail.stats.filesChanged} file{detail.stats.filesChanged !== 1 ? 's' : ''}{' '}
                    changed
                  </span>
                </div>
                <div className="flex gap-3 text-[11px] font-mono pl-5 tabular-nums">
                  {detail.stats.additions > 0 && (
                    <span className="text-[hsl(var(--git-added))]">
                      +{detail.stats.additions}
                    </span>
                  )}
                  {detail.stats.deletions > 0 && (
                    <span className="text-[hsl(var(--git-deleted))]">
                      -{detail.stats.deletions}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Refs */}
            {detail.commit.refs.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2 border-t border-border/40">
                {detail.commit.refs.map((ref) => (
                  <span
                    key={ref.name}
                    className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold bg-accent text-foreground/90"
                  >
                    {ref.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
