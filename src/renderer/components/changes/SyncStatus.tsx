import { ArrowDown, ArrowUp } from 'lucide-react';
import type { GitStatus } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { TextLink } from '../ui/TextLink';
import { Tooltip } from '../ui/Tooltip';
import { firstFitting, useFittedDensity } from '../ui/useFittedDensity';

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

/** The words after each count: the first names the commits, "3 commits ahead,
 *  2 behind", "1 commit behind"; a zero side has none. */
export function syncWords(ahead: number, behind: number): { ahead: string; behind: string } {
  const commits = (n: number) => (n === 1 ? 'commit' : 'commits');
  return {
    ahead: `${commits(ahead)} ahead`,
    behind: ahead > 0 ? 'behind' : `${commits(behind)} behind`,
  };
}

/** "3 commits ahead, 1 behind", "2 commits behind": the words with their
 *  counts, a zero side left out (the compact text's tooltip). */
export function syncSentence(ahead: number, behind: number): string {
  const words = syncWords(ahead, behind);
  const parts = [ahead > 0 && `${ahead} ${words.ahead}`, behind > 0 && `${behind} ${words.behind}`];
  return parts.filter(Boolean).join(', ');
}

/** How the sync text fits its room: in words, or (narrow) "↑3 ↓1". */
export type SyncDensity = 'words' | 'arrows';

/** The measured densities, widest first; `arrows` is the floor. */
const SYNC_MEASURED = ['words'] as const;

/** Room the words must leave beyond their natural width, so they never run
 *  up against what follows them in the row (Files' "Show filetree"). */
export const SYNC_COMFORT_PX = 16;

/** Words while their natural width (`needs[0]`) plus `SYNC_COMFORT_PX` fits
 *  `available`, else arrows. */
export const fitSync = (available: number, needs: readonly number[]): SyncDensity =>
  firstFitting(available - SYNC_COMFORT_PX, needs, SYNC_MEASURED) ?? 'arrows';

const arrowIcon = { size: 12, strokeWidth: 1.8, 'aria-hidden': true } as const;

/** One side's count and what follows it: the words, or an arrow before it. */
function SyncPart({
  count,
  words,
  side,
  density,
}: {
  count: number;
  words: string;
  side: 'ahead' | 'behind';
  density: SyncDensity;
}) {
  const tone = side === 'ahead' ? 'text-loc-add' : 'text-loc-del';
  if (density === 'words') {
    return (
      <>
        <span className={tone}>{count}</span> {words}
      </>
    );
  }
  const Arrow = side === 'ahead' ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center', tone)}>
      <Arrow {...arrowIcon} />
      {count}
    </span>
  );
}

/** The text at `density`, each side a link to its commits; a bare copy (for
 *  measuring) has no links. */
function SyncLine({
  status: { ahead, behind },
  density,
  links,
}: {
  status: Sync;
  density: SyncDensity;
  links?: SyncLinks;
}) {
  const words = syncWords(ahead, behind);
  // The compact text names itself in one tooltip, so its links carry none.
  const titled = density === 'words';
  const part = (side: 'ahead' | 'behind', count: number, title: string, onClick?: () => void) => {
    const text = <SyncPart count={count} words={words[side]} side={side} density={density} />;
    if (!links) return text;
    return (
      <TextLink look="muted" title={titled ? title : undefined} onClick={onClick}>
        {text}
      </TextLink>
    );
  };
  return (
    <span className="whitespace-nowrap text-ink-2 tabular-nums">
      {ahead > 0 && part('ahead', ahead, 'Show the unpushed commits', links?.onShowUnpushed)}
      {ahead > 0 && behind > 0 && (density === 'words' ? ', ' : ' ')}
      {behind > 0 && part('behind', behind, "Show the upstream's commits", links?.onShowUpstream)}
    </span>
  );
}

/**
 * "3 commits ahead, 1 behind", for a branch and upstream that have moved apart
 * (`isOutOfSync`): Files' top row, always. Secondary ink, the counts green and
 * red, each part a link to those commits; it inherits size. Where the words
 * don't fit (measured, `fitSync`) it reads "↑3 ↓1", the words in its tooltip.
 * It takes the room it is given (it grows to fill a flex row).
 */
export function SyncText({ status, links }: { status: Sync; links: SyncLinks }) {
  const { rootRef, sizerRef, density } = useFittedDensity<SyncDensity>(
    fitSync,
    'words',
    `${status.ahead}:${status.behind}`,
  );
  const line = <SyncLine status={status} density={density} links={links} />;
  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-1">
      {density === 'words' ? (
        line
      ) : (
        <Tooltip
          content={{
            title: syncSentence(status.ahead, status.behind),
            body: 'Click a count to show those commits.',
          }}
        >
          <span className="flex min-w-0">{line}</span>
        </Tooltip>
      )}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <div className="w-max">
          <SyncLine status={status} density="words" />
        </div>
      </div>
    </div>
  );
}
