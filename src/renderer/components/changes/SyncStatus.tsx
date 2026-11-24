import { ArrowDown, ArrowUp } from 'lucide-react';
import type { GitStatus } from '../../../shared/types';

/**
 * Where the branch stands against its upstream: "↑ 32 ahead · ↓ 6 behind"
 * (the arrows and counts in the lines-added/deleted green and red), "Up to
 * date", or "No upstream".
 */
export function SyncStatus({
  status,
}: {
  status: Pick<GitStatus, 'hasUpstream' | 'ahead' | 'behind'>;
}) {
  if (!status.hasUpstream) return <span>No upstream</span>;
  const { ahead, behind } = status;
  if (!ahead && !behind) return <span>Up to date with upstream</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      {ahead > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowUp size={14} strokeWidth={1.8} className="text-loc-add" />
          <span className="text-loc-add">{ahead}</span> ahead
        </span>
      )}
      {ahead > 0 && behind > 0 && <span aria-hidden>·</span>}
      {behind > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowDown size={14} strokeWidth={1.8} className="text-loc-del" />
          <span className="text-loc-del">{behind}</span> behind
        </span>
      )}
    </span>
  );
}
