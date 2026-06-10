import React, { useCallback, useEffect, useState } from 'react';
import { Leaf, Zap, RefreshCw, ChevronRight, ChevronDown, Info } from 'lucide-react';
import type { CarbonStats } from '../../shared/types';
import { carbonGramsFromWh, householdComparison, flightComparison } from '../../shared/carbon';
import { formatEnergy, formatCarbon, formatTokens } from '../../shared/format';
import { useGridIntensity } from '../hooks/useGridIntensity';
import { Tooltip } from './ui/Tooltip';

const MODEL_ORDER: Array<{ key: string; label: string }> = [
  { key: 'opus', label: 'Opus' },
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'haiku', label: 'Haiku' },
];

function StatBlock({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-foreground tabular-nums truncate">
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/70 truncate">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * Estimated energy/carbon for a set of Claude Code paths. Pass `paths` to scope to
 * a project (its repo path + each task's worktree path); omit for the lifetime total.
 */
export function CarbonPanel({ paths }: { paths?: string[] }) {
  const [stats, setStats] = useState<CarbonStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [gridIntensity, setGridIntensity] = useGridIntensity();

  // Stable key so the fetch effect re-runs when the project's path set changes,
  // not on every parent re-render (which hands us a fresh array reference).
  const pathsKey = paths ? paths.join('\n') : '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.getCarbonStats(
        pathsKey ? pathsKey.split('\n') : undefined,
      );
      if (res.success && res.data) setStats(res.data);
      else setError(res.error ?? 'Failed to load carbon stats');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [pathsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const grams = stats ? carbonGramsFromWh(stats.energyWh, gridIntensity) : 0;

  function renderBody(): React.ReactNode {
    if (error) {
      return <div className="px-4 py-4 text-[12px] text-destructive">{error}</div>;
    }
    if (!stats) {
      return (
        <div className="px-4 py-4 text-[12px] text-muted-foreground">
          {loading ? 'Calculating…' : 'No data yet.'}
        </div>
      );
    }
    if (stats.tokens === 0) {
      return (
        <div className="px-4 py-4 text-[12px] text-muted-foreground">
          No Claude Code sessions recorded for this project yet.
        </div>
      );
    }

    return (
      <>
        {/* Hero stats */}
        <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatBlock
            icon={<Leaf size={20} strokeWidth={1.6} className="text-emerald-400" />}
            label="CO₂e (est.)"
            value={formatCarbon(grams)}
            sub={flightComparison(grams)}
          />
          <StatBlock
            icon={<Zap size={20} strokeWidth={1.6} className="text-amber-400" />}
            label="Energy (est.)"
            value={formatEnergy(stats.energyWh)}
            sub={householdComparison(stats.energyWh)}
          />
          <StatBlock
            icon={<span className="text-[20px] leading-none text-sky-400 font-semibold">∑</span>}
            label="Tokens"
            value={formatTokens(stats.tokens)}
            sub={`${stats.sessionCount} session${stats.sessionCount === 1 ? '' : 's'}`}
          />
        </div>

        {/* Grid intensity control */}
        <div className="px-4 pb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <label htmlFor="grid-intensity">Grid intensity</label>
          <input
            id="grid-intensity"
            type="number"
            min={1}
            value={gridIntensity}
            onChange={(e) => setGridIntensity(Number(e.target.value))}
            className="w-20 px-2 py-1 rounded-md bg-[hsl(var(--surface-2))] border border-border text-foreground tabular-nums focus:outline-none focus:border-primary/50"
          />
          <span>gCO₂e/kWh</span>
        </div>

        {/* Expandable breakdown */}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="w-full flex items-center gap-1.5 px-4 py-2 border-t border-border/40 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown size={13} strokeWidth={2} />
          ) : (
            <ChevronRight size={13} strokeWidth={2} />
          )}
          Breakdown
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-4">
            {/* By model */}
            <div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1.5">
                By model (effective tokens)
              </div>
              <div className="space-y-1">
                {MODEL_ORDER.map(({ key, label }) => {
                  const t = stats.tokensByModel[key] ?? 0;
                  if (t === 0) return null;
                  const pct = stats.tokens > 0 ? (t / stats.tokens) * 100 : 0;
                  return (
                    <div key={key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-14 text-foreground/80">{label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 text-right tabular-nums text-muted-foreground">
                        {formatTokens(t)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By worktree — only meaningful when the project spans more than one folder */}
            {stats.projects.length > 1 && (
              <div>
                <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1.5">
                  By worktree
                </div>
                <div className="space-y-1">
                  {stats.projects.slice(0, 8).map((p) => (
                    <div
                      key={p.project}
                      className="flex items-center justify-between gap-3 text-[11px]"
                    >
                      <span className="truncate text-foreground/80">{p.project}</span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                        {formatCarbon(carbonGramsFromWh(p.energyWh, gridIntensity))} ·{' '}
                        {formatEnergy(p.energyWh)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--surface-1))] overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Leaf size={15} strokeWidth={1.8} className="text-emerald-400" />
          <span className="text-[12px] font-medium text-foreground">Energy &amp; Carbon</span>
          <Tooltip
            content={`Rough estimate from this project's Claude Code token usage. Coefficients are inferred from pricing ratios and public research — treat as ballpark figures, not measurements.`}
          >
            <Info size={12} strokeWidth={1.8} className="text-muted-foreground/60" />
          </Tooltip>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Recalculate"
        >
          <RefreshCw size={12} strokeWidth={1.8} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {renderBody()}
    </div>
  );
}
