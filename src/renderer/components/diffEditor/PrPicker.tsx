import { useEffect, useMemo, useState } from 'react';
import { GitPullRequestArrow, Loader2, Search, X } from 'lucide-react';
import type { PullRequest } from '@shared/types';

interface PrPickerProps {
  projectId: string;
  cwd: string;
  /** The PR the editor shows, highlighted in the list. */
  selected: number | null;
  /** Open the PR; resolves false when it couldn't be loaded (the host says why). */
  onSelect: (number: number) => Promise<boolean>;
  /** In a PR view: go back to the working tree. */
  onExit?: () => void;
}

/** The project's open PRs (GitHub or Azure DevOps), with a search input. */
export function PrPicker({ projectId, cwd, selected, onSelect, onExit }: PrPickerProps) {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI
      .prReviewList({ projectId, cwd })
      .then((resp) => {
        if (cancelled) return;
        if (resp.success && resp.data) setPrs(resp.data.prs);
        else setError(resp.error ?? 'Failed to list pull requests');
      })
      .catch((err: unknown) => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, cwd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '');
    if (!q) return prs;
    return prs.filter(
      (p) =>
        String(p.number).startsWith(q) ||
        p.title.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q),
    );
  }, [prs, search]);

  // A number that isn't an open PR (a merged or closed one) can still be opened.
  const typedNumber = /^#?\d+$/.test(search.trim()) ? Number(search.trim().replace('#', '')) : null;
  const offerTyped = typedNumber !== null && !prs.some((p) => p.number === typedNumber);

  async function open(number: number) {
    if (opening !== null) return;
    setOpening(number);
    try {
      await onSelect(number);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-2.5 py-2 border-b border-border/40 flex items-center gap-1.5">
        <Search size={12} strokeWidth={1.8} className="text-muted-fade-60 shrink-0" />
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by number, title or author"
          className="flex-1 bg-transparent outline-hidden text-[12px] placeholder:text-muted-fade-40"
        />
      </div>
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] border-b border-border/40 text-muted-fade-80 hover:text-foreground hover:bg-[hsl(var(--surface-2)/0.6)] transition-colors"
        >
          <X size={12} strokeWidth={1.8} className="shrink-0" />
          <span className="flex-1">Exit PR</span>
          <GitPullRequestArrow size={11} strokeWidth={1.8} className="shrink-0 opacity-50" />
        </button>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {loading && <div className="px-3 py-2 text-[11px] text-muted-fade-40">Loading…</div>}
        {error && <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>}
        {offerTyped && (
          <button
            type="button"
            disabled={opening !== null}
            onClick={() => void open(typedNumber)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-fg-fade-85 hover:bg-[hsl(var(--surface-2)/0.6)] transition-colors disabled:cursor-wait"
          >
            <GitPullRequestArrow size={12} strokeWidth={1.8} className="shrink-0 opacity-60" />
            <span className="flex-1">Open PR #{typedNumber}</span>
            {opening === typedNumber && (
              <Loader2 size={12} strokeWidth={1.8} className="animate-spin shrink-0" />
            )}
          </button>
        )}
        {!loading && !error && filtered.length === 0 && !offerTyped && (
          <div className="px-3 py-2 text-[11px] text-muted-fade-40">No open pull requests</div>
        )}
        {filtered.map((p) => {
          const active = p.number === selected;
          return (
            <button
              key={p.number}
              type="button"
              disabled={opening !== null}
              onClick={() => void open(p.number)}
              className={`w-full flex flex-col gap-0.5 px-3 py-1.5 text-left transition-colors disabled:cursor-wait ${
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-fg-fade-85 hover:bg-[hsl(var(--surface-2)/0.6)]'
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0 text-[12px]">
                <span className="font-mono tabular-nums text-muted-fade-70 shrink-0">
                  #{p.number}
                </span>
                <span className="truncate flex-1">{p.title}</span>
                {opening === p.number && (
                  <Loader2 size={12} strokeWidth={1.8} className="animate-spin shrink-0" />
                )}
              </span>
              <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-fade-60">
                {p.author && <span className="shrink-0">@{p.author}</span>}
                <span className="font-mono truncate">{p.headRefName}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
