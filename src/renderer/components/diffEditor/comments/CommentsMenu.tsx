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
import { scopeLabel } from './commentScope';
import type { DiffComment } from './types';

const ACCORDION_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
const ROW_TRANSITION = { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

interface Props {
  /** All comments across every view (scope). */
  commentsByFile: Record<string, DiffComment[]>;
  currentFilePath: string;
  /** Scope of the open view — its section sorts first and is highlighted. */
  currentScope: string;
  /** Live range for a comment in the OPEN view's current file (else null). */
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  /** Jump to a comment — switches to its view (scope) + file as needed. */
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onUnsend: (commentId: string) => void;
  /** Send all unsent comments of one view. */
  onSendScope: (scope: string) => void;
  /** Send every unsent comment across all views. Closes the menu. */
  onSendAll: () => void;
  /** Open the edit-before-send modal prefilled with every unsent comment. */
  onEditAndSend: () => void;
  /** Send a single comment. Keeps the dropdown open. */
  onSendOne: (commentId: string) => void;
}

function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf('/');
  if (i < 0) return { dir: '', base: p };
  return { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

type Group = [string, DiffComment[]];

/** Bucket comments by file (matching `predicate`), current file first. */
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

interface ScopeView {
  scope: string;
  label: string;
  isCurrent: boolean;
  groups: Group[];
  count: number;
}

export function CommentsMenu({
  commentsByFile,
  currentFilePath,
  currentScope,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onUnsend,
  onSendScope,
  onSendAll,
  onEditAndSend,
  onSendOne,
}: Props) {
  const [open, setOpen] = useState(false);

  const { unsentViews, sentViews, totalUnsent, totalSent } = useMemo(() => {
    const byScope = new Map<string, Record<string, DiffComment[]>>();
    for (const [path, list] of Object.entries(commentsByFile)) {
      for (const c of list) {
        let rec = byScope.get(c.viewScope);
        if (!rec) {
          rec = {};
          byScope.set(c.viewScope, rec);
        }
        (rec[path] ??= []).push(c);
      }
    }
    const orderedScopes = Array.from(byScope.keys()).sort((a, b) => {
      if (a === currentScope) return -1;
      if (b === currentScope) return 1;
      if (a === 'live') return -1;
      if (b === 'live') return 1;
      return a.localeCompare(b);
    });
    const view = (scope: string, predicate: (c: DiffComment) => boolean): ScopeView => {
      const groups = bucketByFile(byScope.get(scope)!, predicate, currentFilePath);
      return {
        scope,
        label: scopeLabel(scope),
        isCurrent: scope === currentScope,
        groups,
        count: groups.reduce((n, [, l]) => n + l.length, 0),
      };
    };
    const unsent = orderedScopes.map((s) => view(s, (c) => !c.sent)).filter((v) => v.count > 0);
    const sent = orderedScopes.map((s) => view(s, (c) => c.sent)).filter((v) => v.count > 0);
    return {
      unsentViews: unsent,
      sentViews: sent,
      totalUnsent: unsent.reduce((n, v) => n + v.count, 0),
      totalSent: sent.reduce((n, v) => n + v.count, 0),
    };
  }, [commentsByFile, currentScope, currentFilePath]);

  const noUnsent = totalUnsent === 0;

  const rowHandlers = {
    getLiveRangeForCurrent,
    onNavigate,
    onRemove,
    onSendOne,
    onUnsend,
    closeMenu: () => setOpen(false),
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`group/trigger flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-full text-[11px] font-medium border backdrop-blur-md transition-all duration-200 ease-out ${
            noUnsent
              ? 'border-border/40 bg-foreground/2.5 text-muted-foreground/80 hover:bg-foreground/6 hover:border-border/55 hover:text-foreground/90'
              : 'border-primary/30 bg-primary/9 text-primary hover:bg-primary/[0.14] hover:border-primary/45'
          }`}
          style={{ boxShadow: noUnsent ? undefined : 'inset 0 1px 0 hsl(0 0% 100% / 0.06)' }}
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
                <span className="font-semibold">{totalUnsent}</span> to send
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
        <div className="flex items-baseline justify-between px-4 pt-3 pb-2.5 border-b border-foreground/6 shrink-0">
          <h3 className="text-[12px] font-semibold tracking-tight text-foreground/90">Comments</h3>
          <span className="text-[10.5px] text-muted-foreground/60 tabular-nums tracking-tight">
            {totalUnsent + totalSent} total
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {unsentViews.map((v) => (
            <UnsentSection
              key={v.scope}
              view={v}
              currentFilePath={currentFilePath}
              onSendScope={() => onSendScope(v.scope)}
              {...rowHandlers}
            />
          ))}
          {totalSent > 0 && (
            <SentSection
              views={sentViews}
              total={totalSent}
              currentFilePath={currentFilePath}
              {...rowHandlers}
            />
          )}
          {noUnsent && totalSent === 0 && (
            <div className="px-4 py-6 text-center text-[11px] italic text-muted-foreground/55">
              No comments yet.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-foreground/6 bg-foreground/2 shrink-0">
          <span className="text-[10.5px] text-muted-foreground/65 leading-tight">
            {noUnsent ? (
              <>All caught up</>
            ) : (
              <>
                <span className="font-medium text-foreground/85 tabular-nums">{totalUnsent}</span>{' '}
                across {unsentViews.length} view{unsentViews.length !== 1 ? 's' : ''}
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
                onSendAll();
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

interface RowHandlers {
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onUnsend: (commentId: string) => void;
  closeMenu: () => void;
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

function UnsentSection({
  view,
  currentFilePath,
  onSendScope,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
  closeMenu,
}: { view: ScopeView; currentFilePath: string; onSendScope: () => void } & RowHandlers) {
  const [open, setOpen] = useState(true);
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
              <ChevronDown
                size={12}
                strokeWidth={2}
                className="text-muted-foreground/70 shrink-0"
              />
            ) : (
              <ChevronRight
                size={12}
                strokeWidth={2}
                className="text-muted-foreground/70 shrink-0"
              />
            )}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${view.isCurrent ? 'bg-primary/80' : 'bg-primary/50'}`}
              aria-hidden
            />
            <span className="text-[11px] font-semibold tracking-tight text-foreground/90 truncate">
              {view.label}
            </span>
            {view.isCurrent && (
              <span className="shrink-0 text-[9px] uppercase tracking-wider font-medium text-primary/75">
                current
              </span>
            )}
            <span className="text-[10.5px] text-muted-foreground/60 tabular-nums shrink-0">
              {view.count} to send
            </span>
          </button>
          <button
            type="button"
            onClick={onSendScope}
            title={`Send ${view.count} comment${view.count !== 1 ? 's' : ''} in ${view.label}`}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium text-primary hover:bg-primary/12 active:scale-[0.98] transition"
          >
            <Send size={10} strokeWidth={2.2} />
            Send
          </button>
        </div>
      </StickyHeader>
      <SectionBody open={open}>
        {view.groups.map(([path, list], gi) => (
          <FileGroup
            key={path}
            path={path}
            scope={view.scope}
            list={list}
            isCurrent={path === currentFilePath}
            marginTop={gi > 0}
            getLiveRangeForCurrent={view.isCurrent ? getLiveRangeForCurrent : () => null}
            onNavigate={onNavigate}
            onRemove={onRemove}
            onSendOne={onSendOne}
            onUnsend={onUnsend}
            closeMenu={closeMenu}
          />
        ))}
      </SectionBody>
    </div>
  );
}

function SentSection({
  views,
  total,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
  closeMenu,
}: { views: ScopeView[]; total: number; currentFilePath: string } & RowHandlers) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-foreground/5 last:border-b-0">
      <StickyHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-foreground/[0.035] transition-colors"
        >
          {open ? (
            <ChevronDown size={12} strokeWidth={2} className="text-muted-foreground/70 shrink-0" />
          ) : (
            <ChevronRight size={12} strokeWidth={2} className="text-muted-foreground/70 shrink-0" />
          )}
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" aria-hidden />
          <span className="text-[11px] font-semibold tracking-tight text-muted-foreground/85">
            Sent
          </span>
          <span className="text-[10.5px] text-muted-foreground/60 tabular-nums">{total}</span>
        </button>
      </StickyHeader>
      <SectionBody open={open}>
        {views.map((v) => (
          <div key={v.scope} className="mt-1 first:mt-0">
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
              <span className="text-[9px] uppercase tracking-wider font-medium text-muted-foreground/50">
                {v.label}
              </span>
            </div>
            {v.groups.map(([path, list], gi) => (
              <FileGroup
                key={`${v.scope}-${path}`}
                path={path}
                scope={v.scope}
                list={list}
                isCurrent={v.isCurrent && path === currentFilePath}
                marginTop={gi > 0}
                getLiveRangeForCurrent={v.isCurrent ? getLiveRangeForCurrent : () => null}
                onNavigate={onNavigate}
                onRemove={onRemove}
                onSendOne={onSendOne}
                onUnsend={onUnsend}
                closeMenu={closeMenu}
              />
            ))}
          </div>
        ))}
      </SectionBody>
    </div>
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

interface FileGroupProps extends RowHandlers {
  path: string;
  scope: string;
  list: DiffComment[];
  isCurrent: boolean;
  marginTop: boolean;
}

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
}: FileGroupProps) {
  const { dir, base } = splitPath(path);
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
                  className="flex-1 min-w-0 flex flex-col gap-1 px-2.5 py-1.5 pr-14 text-left rounded-md"
                >
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 shrink-0">
                    {lineLabel}
                  </span>
                  <span
                    className={`text-[12.5px] leading-snug whitespace-pre-wrap wrap-break-word ${
                      c.sent ? 'text-foreground/55' : 'text-foreground/90'
                    }`}
                  >
                    {c.text}
                  </span>
                </button>
                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
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
