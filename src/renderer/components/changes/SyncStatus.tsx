import { ArrowDown, ArrowUp } from 'lucide-react';
import type { GitStatus } from '../../../shared/types';
import { TextLink } from '../ui/TextLink';

/** Where each count leads: the unpushed commits, the upstream's commits. */
export interface SyncLinks {
  /** History, the unpushed commits marked, on the newest. */
  onShowUnpushed: () => void;
  /** The commit graph, on the upstream's tip (History doesn't list its commits). */
  onShowUpstream: () => void;
}

/**
 * Where the branch stands against its upstream: "↑ 32 ahead" over "↓ 6
 * behind", one per line (the arrows and counts in the lines-added/deleted
 * green and red), each a link to those commits; "Up to date with upstream",
 * or "No upstream". The lines start flush with each other wherever the block
 * sits (centred in an empty view, in a details row). `quiet` links underline
 * only on hover, as values in a row do.
 */
export function SyncStatus({
  status,
  links,
  quiet = false,
}: {
  status: Pick<GitStatus, 'hasUpstream' | 'ahead' | 'behind'>;
  links: SyncLinks;
  quiet?: boolean;
}) {
  if (!status.hasUpstream) return <span>No upstream</span>;
  const { ahead, behind } = status;
  if (!ahead && !behind) return <span>Up to date with upstream</span>;
  return (
    <span className="inline-grid justify-items-start py-0.5 text-left tabular-nums">
      {ahead > 0 && (
        <TextLink quiet={quiet} title="Show the unpushed commits" onClick={links.onShowUnpushed}>
          <span className="inline-flex items-center gap-1">
            <ArrowUp size={14} strokeWidth={1.8} className="text-loc-add" />
            <span className="text-loc-add">{ahead}</span> ahead
          </span>
        </TextLink>
      )}
      {behind > 0 && (
        <TextLink quiet={quiet} title="Show the upstream's commits" onClick={links.onShowUpstream}>
          <span className="inline-flex items-center gap-1">
            <ArrowDown size={14} strokeWidth={1.8} className="text-loc-del" />
            <span className="text-loc-del">{behind}</span> behind
          </span>
        </TextLink>
      )}
    </span>
  );
}
