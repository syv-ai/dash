import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GitCommit, GitPullRequestArrow, History } from 'lucide-react';
import { formatRelativeTime } from '@shared/relativeTime';
import type { FileChange } from '../../../shared/types';
import type { CommitSummary, EditorView } from './types';
import type { OpenOptions } from './tabs/editorLayout';
import { ListRow } from '../ui/ListRow';
import { CountBadge } from '../ui/CountBadge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Markdown } from '../ui/Markdown';
import { HoverCard } from '../ui/HoverCard';
import { CommitHoverCard } from '../commits/CommitHoverCard';
import { LineStats } from '../ui/LineStats';

/** The task's open PR in History. `threads` and `body` are null until its
 *  review is fetched. */
export interface PrEntry {
  number: number;
  title: string;
  body: string | null;
  threads: number | null;
  /** The task is reviewing it (Review clicked, not yet submitted). */
  inReview: boolean;
  onOpen: () => void;
  /** Start reviewing it, and open it. */
  onReview: () => void;
  /** The hover card opened: fetch the review if it isn't yet. */
  onPeek: () => void;
}

interface HistoryListProps {
  /** The checkout the commits are read from. */
  cwd: string;
  commits: CommitSummary[];
  loading: boolean;
  view: EditorView;
  /** The working tree, or a commit. */
  onSelectView: (view: EditorView) => void;
  /** Comments needing attention per scope ('live' / 'commit:<hash>'). */
  commentCountByScope: Map<string, number>;
  /** The task's open PR, as a row that opens the PR view. */
  pr: PrEntry | null;
  /** The selected commit's files (listed under it), once loaded. */
  commitFiles: FileChange[];
  /** The file showing in the focused editor group. */
  activePath: string | null;
  /** A click opens a preview tab; a double-click keeps it. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
}

/**
 * The task's history: the working tree, its open PR, then its commits. The
 * selected commit unfolds its files; picking one shows that commit's diff of
 * it in the editor.
 */
export function HistoryList({
  cwd,
  commits,
  loading,
  view,
  onSelectView,
  commentCountByScope,
  pr,
  commitFiles,
  activePath,
  onOpenFile,
}: HistoryListProps) {
  const activeHash = view.kind === 'commit' ? view.hash : null;
  // The selected commit unfolds its files; clicking it again folds them away
  // (the view stays on the commit). Picking another commit unfolds that one.
  const [foldedHash, setFoldedHash] = useState<string | null>(null);
  const selectCommit = (hash: string) => {
    if (hash === activeHash) {
      setFoldedHash((f) => (f === hash ? null : hash));
      return;
    }
    setFoldedHash(null);
    onSelectView({ kind: 'commit', hash });
  };

  // Keep the selected row in sight when the view changes elsewhere.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [view]);

  const liveComments = commentCountByScope.get('live') ?? 0;
  return (
    <div
      ref={listRef}
      className="scrollbar-gutter-stable scrollbar-thin-hover flex h-full min-h-0 flex-col gap-px overflow-y-auto pb-2"
    >
      {/* Always first: the only editable view, and the way back from a commit. */}
      <ListRow
        size="sm"
        selected={view.kind === 'working'}
        leading={<GitCommit size={14} strokeWidth={1.8} className="text-icon" />}
        trailing={liveComments > 0 && <CountBadge count={liveComments} />}
        onClick={() => onSelectView({ kind: 'working', ref: 'HEAD' })}
      >
        Working tree
      </ListRow>
      {pr && <PrRow pr={pr} selected={view.kind === 'pr'} />}
      {loading && commits.length === 0 && <EmptyState title="Loading…" />}
      {!loading && commits.length === 0 && (
        <EmptyState icon={<History size={14} strokeWidth={1.8} />} title="No commits yet" />
      )}
      {commits.map((c) => {
        const selected = c.hash === activeHash;
        const unfolded = selected && foldedHash !== c.hash;
        return (
          <div key={c.hash} className="flex flex-col gap-px">
            <CommitRow
              commit={c}
              cwd={cwd}
              selected={selected}
              unfolded={unfolded}
              commentCount={commentCountByScope.get(`commit:${c.hash}`) ?? 0}
              onSelect={() => selectCommit(c.hash)}
            />
            {unfolded &&
              commitFiles.map((f) => (
                <ListRow
                  key={f.path}
                  size="sm"
                  indent={1}
                  dimmed
                  selected={f.path === activePath}
                  title={f.path}
                  trailing={
                    <span className="text-xs">
                      <LineStats add={f.additions} del={f.deletions} />
                    </span>
                  }
                  onClick={(e) => onOpenFile(f.path, { toSide: e.altKey, preview: true })}
                  onDoubleClick={() => onOpenFile(f.path)}
                >
                  {f.path.slice(f.path.lastIndexOf('/') + 1)}
                </ListRow>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function CommitRow({
  commit,
  cwd,
  selected,
  unfolded,
  commentCount,
  onSelect,
}: {
  commit: CommitSummary;
  cwd: string;
  selected: boolean;
  /** Its files are listed under it. */
  unfolded: boolean;
  commentCount: number;
  /** Select it, or (selected already) fold or unfold its files. */
  onSelect: () => void;
}) {
  const Chevron = unfolded ? ChevronDown : ChevronRight;
  const when = formatRelativeTime(commit.authorDate, Date.now() / 1000);
  return (
    <CommitHoverCard
      commit={commit}
      cwd={cwd}
      trigger={(hover) => (
        <ListRow
          size="sm"
          selected={selected}
          aria-expanded={selected ? unfolded : undefined}
          leading={
            <span className="flex items-center gap-1 text-xs text-ink-3 tabular-nums">
              <Chevron
                size={14}
                strokeWidth={1.8}
                className={selected ? '' : 'invisible'}
                aria-hidden
              />
              {commit.shortHash}
            </span>
          }
          trailing={
            <>
              {commentCount > 0 && <CountBadge count={commentCount} />}
              <span className="text-xs tabular-nums">{when}</span>
            </>
          }
          onClick={onSelect}
          {...hover}
        >
          {commit.subject || '(no subject)'}
        </ListRow>
      )}
    />
  );
}

/** The task's PR: opens the PR view, with Review (or "In review") and a hover
 *  card holding its description. */
function PrRow({ pr, selected }: { pr: PrEntry; selected: boolean }) {
  return (
    <HoverCard
      onOpen={pr.onPeek}
      trigger={(hover) => (
        <ListRow
          as="div"
          role="button"
          tabIndex={0}
          size="sm"
          selected={selected}
          leading={<GitPullRequestArrow size={14} strokeWidth={1.8} className="text-icon" />}
          trailing={
            <>
              {(pr.threads ?? 0) > 0 && <CountBadge count={pr.threads!} />}
              <Button
                size="sm"
                variant={pr.inReview ? 'secondary' : 'primary'}
                title={
                  pr.inReview
                    ? 'Your review is in progress'
                    : 'Review: what you write becomes a PR comment, sent on Submit'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  (pr.inReview ? pr.onOpen : pr.onReview)();
                }}
              >
                {pr.inReview ? 'In review' : 'Review'}
              </Button>
            </>
          }
          onClick={pr.onOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pr.onOpen();
            }
          }}
          onMouseEnter={hover.onMouseEnter}
          onMouseLeave={hover.onMouseLeave}
        >
          <span className="tabular-nums">#{pr.number}</span> {pr.title}
        </ListRow>
      )}
    >
      <div className="text-base leading-snug font-medium wrap-break-word text-ink">
        #{pr.number} {pr.title}
      </div>
      {pr.body === null ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : pr.body.trim() ? (
        <div className="text-sm leading-relaxed text-ink-2">
          <Markdown text={pr.body} />
        </div>
      ) : (
        <div className="text-sm text-ink-3 italic">No description.</div>
      )}
    </HoverCard>
  );
}
