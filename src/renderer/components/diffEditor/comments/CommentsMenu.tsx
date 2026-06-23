import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MessageSquare,
  Pencil,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import type { DiffComment } from './types';

const ACCORDION_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
const ROW_TRANSITION = { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

interface Props {
  commentsByFile: Record<string, DiffComment[]>;
  currentFilePath: string;
  /** Returns the current model's live range for the given comment id, or
   *  null if the comment isn't in the current file. Lets the dropdown show
   *  up-to-the-second line numbers for the open file (which may have
   *  shifted due to typing) while non-current files fall back to stored. */
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onUnsend: (commentId: string) => void;
  /** Send every unsent comment. Closes the modal afterward. */
  onSend: () => void;
  /** Open the edit-before-send modal pre-filled with every unsent comment. */
  onEditAndSend: () => void;
  /** Send a single comment. Keeps the dropdown + modal open. */
  onSendOne: (commentId: string) => void;
}

/** Split a path into its directory prefix and base name so the directory
 *  can be dimmed and the filename emphasized in the file header. */
function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf('/');
  if (i < 0) return { dir: '', base: p };
  return { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

type Group = [string, DiffComment[]];

/** Bucket comments by file path, keep only non-empty buckets, and place the
 *  current file at the top. Pure for memoization. */
function bucketByFile(
  source: Record<string, DiffComment[]>,
  predicate: (c: DiffComment) => boolean,
  currentFilePath: string,
): Group[] {
  return Object.entries(source)
    .map(([p, list]) => [p, list.filter(predicate)] as Group)
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => {
      if (a === currentFilePath) return -1;
      if (b === currentFilePath) return 1;
      return a.localeCompare(b);
    });
}

export function CommentsMenu({
  commentsByFile,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onUnsend,
  onSend,
  onEditAndSend,
  onSendOne,
}: Props) {
  const [open, setOpen] = useState(false);

  // Parent re-renders on every keystroke / scroll — memoize the two buckets
  // so this menu doesn't reshuffle on each pass.
  const unsentGroups = useMemo(
    () => bucketByFile(commentsByFile, (c) => !c.sent, currentFilePath),
    [commentsByFile, currentFilePath],
  );
  const sentGroups = useMemo(
    () => bucketByFile(commentsByFile, (c) => c.sent, currentFilePath),
    [commentsByFile, currentFilePath],
  );
  const unsentCount = useMemo(
    () => unsentGroups.reduce((n, [, l]) => n + l.length, 0),
    [unsentGroups],
  );
  const sentCount = useMemo(() => sentGroups.reduce((n, [, l]) => n + l.length, 0), [sentGroups]);
  const noUnsent = unsentCount === 0;

  // Accordion state — initialized lazily from the first render's counts so
  // a freshly-opened menu lands on the meaningful section. The user can
  // toggle freely after that; we don't override their choice on every
  // count change.
  const [unsentOpen, setUnsentOpen] = useState(() => unsentCount > 0);
  const [sentOpen, setSentOpen] = useState(() => unsentCount === 0 && sentCount > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`group/trigger flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-full text-[11px] font-medium border backdrop-blur-md transition-all duration-200 ease-out ${
            noUnsent
              ? 'border-border/40 bg-foreground/2.5 text-muted-foreground/80 hover:bg-foreground/6 hover:border-border/55 hover:text-foreground/90'
              : 'border-primary/30 bg-primary/9 text-primary hover:bg-primary/[0.14] hover:border-primary/45'
          }`}
          style={{
            // Inner glass-lip highlight on the active pill — barely
            // perceptible, but it lifts the capsule off the header bar.
            boxShadow: noUnsent ? undefined : 'inset 0 1px 0 hsl(0 0% 100% / 0.06)',
          }}
        >
          <MessageSquare
            size={12}
            strokeWidth={2}
            className={noUnsent ? 'opacity-60' : 'opacity-90'}
          />
          <span className="tabular-nums tracking-tight">
            {noUnsent ? (
              <>0 to send</>
            ) : (
              <>
                <span className="font-semibold">{unsentCount}</span> to send
              </>
            )}
          </span>
          <ChevronUp
            size={11}
            strokeWidth={2.2}
            className="opacity-60 transition-transform duration-200 ease-out group-data-[state=open]/trigger:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="glass-popover w-[460px] max-h-[520px] flex flex-col p-0 overflow-hidden"
      >
        {/* Header. The hairline uses `foreground/0.06` so it reads in both
            themes as a soft fold in the glass, not a hard division line. */}
        <div className="flex items-baseline justify-between px-4 pt-3 pb-2.5 border-b border-foreground/6">
          <h3 className="text-[12px] font-semibold tracking-tight text-foreground/90">Comments</h3>
          <span className="text-[10.5px] text-muted-foreground/60 tabular-nums tracking-tight">
            {unsentCount + sentCount} total
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AccordionSection
            label="Unsent"
            count={unsentCount}
            accent="primary"
            open={unsentOpen}
            onToggle={() => setUnsentOpen((o) => !o)}
            emptyState="No unsent comments — everything's been pushed."
            groups={unsentGroups}
            currentFilePath={currentFilePath}
            getLiveRangeForCurrent={getLiveRangeForCurrent}
            onNavigate={(path, id) => {
              setOpen(false);
              onNavigate(path, id);
            }}
            onRemove={onRemove}
            onSendOne={onSendOne}
            onUnsend={onUnsend}
          />
          {sentCount > 0 && (
            <AccordionSection
              label="Sent"
              count={sentCount}
              accent="muted"
              open={sentOpen}
              onToggle={() => setSentOpen((o) => !o)}
              emptyState="Nothing sent yet."
              groups={sentGroups}
              currentFilePath={currentFilePath}
              getLiveRangeForCurrent={getLiveRangeForCurrent}
              onNavigate={(path, id) => {
                setOpen(false);
                onNavigate(path, id);
              }}
              onRemove={onRemove}
              onSendOne={onSendOne}
              onUnsend={onUnsend}
            />
          )}
        </div>

        {/* Footer. Mirror the header's soft hairline; subtle tinted ground
            so the CTA still has its own visual lane. */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-foreground/6 bg-foreground/2">
          <span className="text-[10.5px] text-muted-foreground/65 leading-tight">
            {noUnsent ? (
              <>All caught up</>
            ) : (
              <>
                <span className="font-medium text-foreground/85 tabular-nums">{unsentCount}</span>{' '}
                ready for your next prompt
              </>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={noUnsent}
              onClick={() => {
                setOpen(false);
                onEditAndSend();
              }}
              title="Edit the assembled prompt before sending"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground/80 hover:text-foreground hover:bg-foreground/6 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <Pencil size={11} strokeWidth={2.2} />
              <span>Edit</span>
            </button>
            <button
              type="button"
              disabled={noUnsent}
              onClick={() => {
                setOpen(false);
                onSend();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <Send size={11} strokeWidth={2.2} />
              <span>Send all</span>
            </button>
          </div>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}

interface AccordionProps {
  label: string;
  count: number;
  /** Accent for the section header dot + comment-card left bars. */
  accent: 'primary' | 'muted';
  open: boolean;
  onToggle: () => void;
  emptyState: string;
  groups: Group[];
  currentFilePath: string;
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onUnsend: (commentId: string) => void;
}

function AccordionSection({
  label,
  count,
  accent,
  open,
  onToggle,
  emptyState,
  groups,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
}: AccordionProps) {
  const isSent = accent === 'muted';
  const dotClass = isSent ? 'bg-muted-foreground/40' : 'bg-primary/70';
  return (
    <div className="border-b border-foreground/5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.035]"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={2} className="text-muted-foreground/70" />
        ) : (
          <ChevronRight size={12} strokeWidth={2} className="text-muted-foreground/70" />
        )}
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden />
        <span
          className={`text-[11px] font-semibold tracking-tight ${
            isSent ? 'text-muted-foreground/85' : 'text-foreground/90'
          }`}
        >
          {label}
        </span>
        <span className="text-[10.5px] text-muted-foreground/60 tabular-nums">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={ACCORDION_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-2 pb-2">
              {count === 0 ? (
                <div className="px-3 py-3 text-[11px] italic text-muted-foreground/55">
                  {emptyState}
                </div>
              ) : (
                groups.map(([path, list], gi) => (
                  <FileGroup
                    key={path}
                    path={path}
                    list={list}
                    isCurrent={path === currentFilePath}
                    marginTop={gi > 0}
                    accent={accent}
                    getLiveRangeForCurrent={getLiveRangeForCurrent}
                    onNavigate={onNavigate}
                    onRemove={onRemove}
                    onSendOne={onSendOne}
                    onUnsend={onUnsend}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FileGroupProps {
  path: string;
  list: DiffComment[];
  isCurrent: boolean;
  marginTop: boolean;
  accent: 'primary' | 'muted';
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onUnsend: (commentId: string) => void;
}

function FileGroup({
  path,
  list,
  isCurrent,
  marginTop,
  accent,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
}: FileGroupProps) {
  const { dir, base } = splitPath(path);
  const isSent = accent === 'muted';
  return (
    <div className={marginTop ? 'mt-2' : ''}>
      <div className="flex items-baseline gap-2 px-2 py-1">
        <span className="font-mono text-[10.5px] truncate">
          {dir && <span className="text-muted-foreground/45">{dir}</span>}
          <span className="text-foreground/80">{base}</span>
        </span>
        {isCurrent && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider font-medium text-primary/75">
            current
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {list.map((c) => {
            const live = isCurrent ? getLiveRangeForCurrent(c.id) : null;
            const start = live?.start ?? c.startLine;
            const end = live?.end ?? c.endLine;
            const lineLabel = start === end ? `L${start}` : `L${start}–${end}`;
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={ROW_TRANSITION}
                className="group/item relative flex rounded-md overflow-hidden transition-colors hover:bg-foreground/4"
              >
                <span
                  aria-hidden
                  className={`shrink-0 w-[3px] rounded-full my-1 transition-colors ${
                    isSent ? 'bg-muted-foreground/25' : 'bg-primary/70'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => onNavigate(path, c.id)}
                  title="Jump to this comment"
                  className="flex-1 min-w-0 flex flex-col gap-1 px-2.5 py-1.5 pr-14 text-left rounded-md"
                >
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 shrink-0">
                    {lineLabel}
                  </span>
                  <span
                    className={`text-[12.5px] leading-snug whitespace-pre-wrap wrap-break-word ${
                      isSent ? 'text-foreground/55' : 'text-foreground/90'
                    }`}
                  >
                    {c.text}
                  </span>
                </button>
                {/* Hover-only action cluster. Either Send (unsent) or Undo
                  (sent), plus Remove. Consistent rule across all states:
                  no action ever shows at rest. */}
                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                  {isSent ? (
                    <ActionButton
                      label="Include in next prompt"
                      onClick={() => onUnsend(c.id)}
                      tone="primary"
                    >
                      <Undo2 size={11} strokeWidth={2} />
                    </ActionButton>
                  ) : (
                    <ActionButton
                      label="Send this comment"
                      onClick={() => onSendOne(c.id)}
                      tone="primary"
                    >
                      <Send size={11} strokeWidth={2} />
                    </ActionButton>
                  )}
                  <ActionButton
                    label="Remove comment"
                    onClick={() => onRemove(path, c.id)}
                    tone="destructive"
                  >
                    <X size={11} strokeWidth={2} />
                  </ActionButton>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone: 'primary' | 'destructive';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'primary'
      ? 'text-muted-foreground/65 hover:text-primary hover:bg-primary/10'
      : 'text-muted-foreground/55 hover:text-destructive hover:bg-destructive/10';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={`p-1 rounded transition ${toneClass}`}
    >
      {children}
    </button>
  );
}
