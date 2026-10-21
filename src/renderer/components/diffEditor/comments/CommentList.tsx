import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronRight, Send, Undo2, X } from 'lucide-react';
import { groupByFile } from './commentScope';
import type { DiffComment } from './types';

/*
 * The comment list both corner widgets are built from: the task's comments
 * menu and the PR view's review menu. Sections with sticky headers, and in
 * them a scope's comments grouped per file, each row with its line, text and
 * hover actions (send or reopen, remove).
 */

const ACCORDION_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
const ROW_TRANSITION = { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf('/');
  if (i < 0) return { dir: '', base: p };
  return { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

export interface RowHandlers {
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onUnsend: (commentId: string) => void;
  closeMenu: () => void;
}

/** What a widget adds to each row. */
export interface RowDecorations {
  /** A tag beside a row's line label (e.g. 'Agent', 'Reply'). */
  renderTag?: (c: DiffComment) => React.ReactNode;
  /** Hover actions before the row's send and remove. */
  renderActions?: (c: DiffComment) => React.ReactNode;
}

/** One scope's comments, a group per file: `firstPath`'s first, then by path. */
export function FileGroups({
  comments,
  scope,
  firstPath,
  currentFilePath,
  ...rest
}: {
  comments: DiffComment[];
  scope: string;
  firstPath?: string;
  /** The open file, marked 'current' and given live ranges; null when this
   *  scope isn't the open view's. */
  currentFilePath: string | null;
} & RowHandlers &
  RowDecorations) {
  return (
    <>
      {groupByFile(comments, firstPath).map(([path, list], gi) => (
        <FileGroup
          key={path}
          path={path}
          scope={scope}
          list={list}
          isCurrent={path === currentFilePath}
          marginTop={gi > 0}
          {...rest}
        />
      ))}
    </>
  );
}

/** Sticky header so it stays visible as the body scrolls — like the right
 *  inspector's section bars. The glass background occludes scrolling rows. */
function StickyHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 bg-[hsl(var(--surface-1)/0.92)] backdrop-blur-md">
      {children}
    </div>
  );
}

/** A collapsible section of the menu: a sticky header (dot, title, count,
 *  actions) over its rows. */
export function MenuSection({
  title,
  dotClass,
  badge,
  count,
  actions,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** The dot's colour. */
  dotClass: string;
  /** A small tag after the title (e.g. 'current'). */
  badge?: string;
  /** Trailing count text, e.g. '3 to send'. */
  count: string;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-foreground/5 last:border-b-0">
      <StickyHeader>
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-foreground/[0.035] transition-colors">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            {open ? (
              <ChevronDown size={12} strokeWidth={2} className="text-muted-fade-70 shrink-0" />
            ) : (
              <ChevronRight size={12} strokeWidth={2} className="text-muted-fade-70 shrink-0" />
            )}
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} aria-hidden />
            <span className="text-[11px] font-semibold tracking-tight text-fg-fade-90 truncate">
              {title}
            </span>
            {badge && (
              <span className="shrink-0 text-[9px] uppercase tracking-wider font-medium text-primary/75">
                {badge}
              </span>
            )}
            <span className="text-[10.5px] text-muted-fade-60 tabular-nums shrink-0">{count}</span>
          </button>
          {actions}
        </div>
      </StickyHeader>
      <SectionBody open={open}>{children}</SectionBody>
    </div>
  );
}

/** A section header's small text button (Send, Clear). */
export function SectionAction({
  label,
  title,
  icon,
  tone,
  onClick,
}: {
  label: string;
  title: string;
  icon: React.ReactNode;
  tone: 'primary' | 'destructive';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'primary'
      ? 'text-primary hover:bg-primary/12'
      : 'text-muted-fade-65 hover:text-destructive hover:bg-destructive/10';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium active:scale-[0.98] transition ${toneClass}`}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
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
          <div className="px-2 pb-2">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface FileGroupProps extends RowHandlers, RowDecorations {
  path: string;
  scope: string;
  list: DiffComment[];
  isCurrent: boolean;
  marginTop: boolean;
}

/** One file's rows: line label, text, and hover actions (send or reopen, remove). */
function FileGroup({
  path,
  scope,
  list,
  isCurrent,
  marginTop,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
  closeMenu,
  renderTag,
  renderActions,
}: FileGroupProps) {
  const { dir, base } = splitPath(path);
  return (
    <div className={marginTop ? 'mt-2' : ''}>
      <div className="flex items-baseline gap-2 px-2 py-1">
        <span className="min-w-0 font-mono text-[10.5px] break-all">
          {dir && <span className="text-muted-fade-45">{dir}</span>}
          <span className="text-fg-fade-80">{base}</span>
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
                    c.sent ? 'bg-muted-foreground/25' : 'bg-primary/70'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    onNavigate(scope, path, c.id);
                  }}
                  title="Jump to this comment"
                  className={`flex-1 min-w-0 flex flex-col gap-1 px-2.5 py-1.5 text-left rounded-md ${renderActions ? 'pr-20' : 'pr-14'}`}
                >
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-muted-fade-70 shrink-0">
                    {lineLabel}
                    {renderTag?.(c)}
                  </span>
                  <span
                    className={`text-[12.5px] leading-snug whitespace-pre-wrap wrap-break-word ${
                      c.sent ? 'text-fg-fade-55' : 'text-fg-fade-90'
                    }`}
                  >
                    {c.text}
                  </span>
                </button>
                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                  {renderActions?.(c)}
                  {c.sent ? (
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

/** A row's hover action. */
export function ActionButton({
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
      ? 'text-muted-fade-65 hover:text-primary hover:bg-primary/10'
      : 'text-muted-fade-55 hover:text-destructive hover:bg-destructive/10';
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
