import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, GitPullRequestArrow, History } from 'lucide-react';
import { formatRelativeTime } from '@shared/relativeTime';
import type { FileChange } from '../../../shared/types';
import type { CommitSummary, EditorView } from './types';
import type { OpenOptions } from './tabs/editorLayout';
import { ListRow } from '../ui/ListRow';
import { CountBadge } from '../ui/CountBadge';
import { EmptyState } from '../ui/EmptyState';
import { Markdown } from '../ui/Markdown';
import { HoverCard } from '../ui/HoverCard';
import { CommitHoverCard } from '../commits/CommitHoverCard';
import { LineStats, lineStatsWidth } from '../ui/LineStats';
import { cn } from '../../lib/cn';

/** The task's open PR in History. `threads` and `body` are null until its
 *  review is fetched. */
export interface PrEntry {
  number: number;
  title: string;
  body: string | null;
  threads: number | null;
  /** Its lines added and deleted; null where the forge doesn't say. */
  additions: number | null;
  deletions: number | null;
  /** Review it: enter review mode for it. */
  onOpen: () => void;
  /** The hover card opened: fetch the review if it isn't yet. */
  onPeek: () => void;
}

interface HistoryListProps {
  /** The checkout the commits are read from. */
  cwd: string;
  commits: CommitSummary[];
  loading: boolean;
  view: EditorView;
  /** A commit. The way back is Files (D29b), so it has no row here. */
  onSelectView: (view: EditorView) => void;
  /** Comments needing attention per scope ('commit:<hash>' is read here). */
  commentCountByScope: Map<string, number>;
  /** The task's open PR, as a row that enters review mode for it (none in
   *  review mode, whose History lists the PR's commits). */
  pr: PrEntry | null;
  /** The selected commit's files (listed under it), once loaded. */
  commitFiles: FileChange[];
  /** The file showing in the focused editor group. */
  activePath: string | null;
  /** A click opens a preview tab; a double-click keeps it. */
  onOpenFile: (path: string, opts?: OpenOptions) => void;
  /** Commits not on the upstream yet: marked with the "ahead" arrow. */
  unpushed?: ReadonlySet<string>;
}

/**
 * The task's history: its open PR, then its commits (in review mode the PR's
 * commits alone). The selected commit unfolds its files; picking one shows that commit's diff of
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
  unpushed,
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

  // The +/− cell fits the list's widest pair, the PR's included.
  const statsWidth = useMemo(() => lineStatsWidth(pr ? [pr, ...commits] : commits), [pr, commits]);

  // Keep the selected row in sight when the view changes elsewhere.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [view]);

  return (
    <div
      ref={listRef}
      className="scrollbar-gutter-stable scrollbar-thin-hover @container flex h-full min-h-0 flex-col gap-px overflow-y-auto pb-2"
    >
      {pr && <PrRow pr={pr} statsWidth={statsWidth} />}
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
              statsWidth={statsWidth}
              selected={selected}
              unfolded={unfolded}
              commentCount={commentCountByScope.get(`commit:${c.hash}`) ?? 0}
              unpushed={unpushed?.has(c.hash) ?? false}
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

/** A commit row's fixed columns, so they line up from row to row; the
 *  subject takes what is left and truncates first. The author shows only
 *  where the list is wide enough (its hover card names it anyway). The
 *  lines added and deleted share one more, sized to the list (`LineStats`). */
const COL = {
  sha: 'w-13 shrink-0',
  when: 'w-7 shrink-0',
  author: 'hidden w-18 shrink-0 truncate @md:block',
} as const;

/**
 * A commit as columns: short sha, age, author, lines added and deleted,
 * then its subject. Comments on it, the "not pushed" arrow and (selected) the fold
 * chevron trail it.
 */
function CommitRow({
  commit,
  cwd,
  statsWidth,
  selected,
  unfolded,
  commentCount,
  unpushed,
  onSelect,
}: {
  commit: CommitSummary;
  cwd: string;
  statsWidth: number;
  selected: boolean;
  /** Its files are listed under it. */
  unfolded: boolean;
  commentCount: number;
  /** Not on the upstream yet. */
  unpushed: boolean;
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
            <span className="flex items-center gap-2 text-xs text-ink-3 tabular-nums">
              <span className={COL.sha}>{commit.shortHash}</span>
              <span className={COL.when}>{when}</span>
              <span className={COL.author}>{commit.authorName}</span>
              <LineStats add={commit.additions} del={commit.deletions} width={statsWidth} />
            </span>
          }
          trailing={
            (commentCount > 0 || unpushed || selected) && (
              <>
                {commentCount > 0 && <CountBadge count={commentCount} />}
                {unpushed && (
                  <ArrowUp
                    size={14}
                    strokeWidth={1.8}
                    className="text-loc-add"
                    aria-label="Not pushed"
                  />
                )}
                {selected && (
                  <Chevron size={14} strokeWidth={1.8} className="text-icon" aria-hidden />
                )}
              </>
            )
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

/** The task's PR: review it (review mode), with a hover card holding its
 *  description. Its icon and number sit in the sha column, its lines in the
 *  commits' line cell. */
function PrRow({ pr, statsWidth }: { pr: PrEntry; statsWidth: number }) {
  return (
    <HoverCard
      onOpen={pr.onPeek}
      trigger={(hover) => (
        <ListRow
          as="div"
          role="button"
          tabIndex={0}
          size="sm"
          leading={
            <span className="flex items-center gap-2 text-xs text-ink-3 tabular-nums">
              <span className={cn(COL.sha, 'flex items-center gap-1')}>
                <GitPullRequestArrow size={14} strokeWidth={1.8} className="text-icon" />
                <span>#{pr.number}</span>
              </span>
              <span className={COL.when} />
              <span className={COL.author} />
              <LineStats add={pr.additions ?? 0} del={pr.deletions ?? 0} width={statsWidth} />
            </span>
          }
          trailing={(pr.threads ?? 0) > 0 && <CountBadge count={pr.threads!} />}
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
          {pr.title}
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
