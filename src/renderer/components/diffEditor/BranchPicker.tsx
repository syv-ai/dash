import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { BranchInfo } from '@shared/types';

interface BranchPickerProps {
  cwd: string;
  /** The currently-selected base ref. Highlighted in the list. */
  selectedRef: string | null;
  /** Picker has no internal "close" — the host owns that lifecycle. */
  onSelect: (ref: string) => void;
}

/** Compact branch list with a search input. Uses the existing
 *  gitListBranches IPC, so it reflects fetched-remote branches. */
export function BranchPicker({ cwd, selectedRef, onSelect }: BranchPickerProps) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI.gitListBranches(cwd).then((resp) => {
      if (cancelled) return;
      if (resp.success && resp.data) {
        setBranches(resp.data);
      } else {
        setError(resp.error ?? 'Failed to list branches');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const filtered = useMemo(
    () => branches.filter((b) => b.name.toLowerCase().includes(search.toLowerCase())),
    [branches, search],
  );

  return (
    <div className="w-[280px] max-h-[360px] flex flex-col">
      <div className="px-2.5 py-2 border-b border-border/40 flex items-center gap-1.5">
        <Search size={12} strokeWidth={1.8} className="text-muted-foreground/60 flex-shrink-0" />
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter branches"
          className="flex-1 bg-transparent outline-none text-[12px] placeholder:text-muted-foreground/40"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {loading && <div className="px-3 py-2 text-[11px] text-muted-foreground/40">Loading…</div>}
        {error && <div className="px-3 py-2 text-[11px] text-destructive">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/40">No branches</div>
        )}
        {filtered.map((b) => {
          const active = b.ref === selectedRef;
          return (
            <button
              key={b.ref}
              type="button"
              onClick={() => onSelect(b.ref)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left text-[12px] font-mono transition-colors ${
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground/85 hover:bg-[hsl(var(--surface-2)/0.6)]'
              }`}
            >
              <span className="truncate flex-1">{b.name}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/50">
                {b.shortHash}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
