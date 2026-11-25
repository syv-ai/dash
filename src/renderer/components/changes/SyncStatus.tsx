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

type Sync = Pick<GitStatus, 'hasUpstream' | 'ahead' | 'behind'>;

/** The branch and its upstream have moved apart: Files' sync text shows. */
export const isOutOfSync = (status: Sync): boolean =>
  status.hasUpstream && (status.ahead > 0 || status.behind > 0);

/**
 * Where the branch stands against its upstream: "↑ 32 ahead" over "↓ 6
 * behind", one per line (the arrows and counts in the lines-added/deleted
 * green and red), each a link to those commits; "Up to date with upstream",
 * or "No upstream" (Details' Upstream row). The lines start flush with each
 * other. The words stay ink, never the link blue; they underline on hover.
 */
export function SyncStatus({ status, links }: { status: Sync; links: SyncLinks }) {
  if (!status.hasUpstream) return <span>No upstream</span>;
  const { ahead, behind } = status;
  if (!ahead && !behind) return <span>Up to date with upstream</span>;
  return (
    <span className="inline-grid justify-items-start py-0.5 text-left tabular-nums">
      {ahead > 0 && (
        <TextLink look="quiet" title="Show the unpushed commits" onClick={links.onShowUnpushed}>
          <span className="inline-flex items-center gap-1">
            <ArrowUp size={14} strokeWidth={1.8} className="text-loc-add" />
            <span className="text-loc-add">{ahead}</span> ahead
          </span>
        </TextLink>
      )}
      {behind > 0 && (
        <TextLink look="quiet" title="Show the upstream's commits" onClick={links.onShowUpstream}>
          <span className="inline-flex items-center gap-1">
            <ArrowDown size={14} strokeWidth={1.8} className="text-loc-del" />
            <span className="text-loc-del">{behind}</span> behind
          </span>
        </TextLink>
      )}
    </span>
  );
}

/**
 * "3 ahead · 1 behind", for a branch and upstream that have moved apart
 * (`isOutOfSync`): Files' top row, or under its "No changes". Secondary ink, the counts green and red, each part a link to
 * those commits; it inherits size.
 */
export function SyncText({ status, links }: { status: Sync; links: SyncLinks }) {
  const { ahead, behind } = status;
  return (
    <span className="inline-flex items-center gap-1 text-ink-2 tabular-nums">
      {ahead > 0 && (
        <TextLink look="muted" title="Show the unpushed commits" onClick={links.onShowUnpushed}>
          <span className="text-loc-add">{ahead}</span> ahead
        </TextLink>
      )}
      {ahead > 0 && behind > 0 && <span aria-hidden>·</span>}
      {behind > 0 && (
        <TextLink look="muted" title="Show the upstream's commits" onClick={links.onShowUpstream}>
          <span className="text-loc-del">{behind}</span> behind
        </TextLink>
      )}
    </span>
  );
}
