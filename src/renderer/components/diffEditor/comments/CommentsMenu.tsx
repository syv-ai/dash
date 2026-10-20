import { useMemo, useState } from 'react';
import { ChevronUp, MessageSquare, Pencil, Send, Trash2 } from 'lucide-react';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { scopeLabel } from './commentScope';
import { FileGroups, MenuSection, SectionAction, type RowHandlers } from './CommentList';
import type { DiffComment } from './types';

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
  /** Remove sent comments — all of them, or just one scope's when given. */
  onClearSent: (scope?: string) => void;
  /** Send all unsent comments of one view. */
  onSendScope: (scope: string) => void;
  /** Send every unsent comment across all views. Closes the menu. */
  onSendAll: () => void;
  /** Open the edit-before-send modal prefilled with every unsent comment. */
  onEditAndSend: () => void;
  /** Send a single comment. Keeps the dropdown open. */
  onSendOne: (commentId: string) => void;
}

interface ScopeView {
  scope: string;
  label: string;
  isCurrent: boolean;
  comments: DiffComment[];
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
  onClearSent,
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
      const comments = Object.values(byScope.get(scope)!).flat().filter(predicate);
      return {
        scope,
        label: scopeLabel(scope),
        isCurrent: scope === currentScope,
        comments,
        count: comments.length,
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
  }, [commentsByFile, currentScope]);

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
              ? 'border-border/40 bg-foreground/2.5 text-muted-fade-80 hover:bg-foreground/6 hover:border-border/55 hover:text-fg-fade-90'
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
          <h3 className="text-[12px] font-semibold tracking-tight text-fg-fade-90">Comments</h3>
          <span className="text-[10.5px] text-muted-fade-60 tabular-nums tracking-tight">
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
              onClearSent={onClearSent}
              {...rowHandlers}
            />
          )}
          {noUnsent && totalSent === 0 && (
            <div className="px-4 py-6 text-center text-[11px] italic text-muted-fade-55">
              No comments yet.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-foreground/6 bg-foreground/2 shrink-0">
          <span className="text-[10.5px] text-muted-fade-65 leading-tight">
            {noUnsent ? (
              <>All caught up</>
            ) : (
              <>
                <span className="font-medium text-fg-fade-85 tabular-nums">{totalUnsent}</span>{' '}
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-muted-fade-80 hover:text-foreground hover:bg-foreground/6 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
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
  return (
    <MenuSection
      title={view.label}
      dotClass={view.isCurrent ? 'bg-primary/80' : 'bg-primary/50'}
      badge={view.isCurrent ? 'current' : undefined}
      count={`${view.count} to send`}
      actions={
        <SectionAction
          label="Send"
          title={`Send ${view.count} comment${view.count !== 1 ? 's' : ''} in ${view.label}`}
          icon={<Send size={10} strokeWidth={2.2} />}
          tone="primary"
          onClick={onSendScope}
        />
      }
    >
      <FileGroups
        comments={view.comments}
        scope={view.scope}
        firstPath={currentFilePath}
        currentFilePath={currentFilePath}
        getLiveRangeForCurrent={view.isCurrent ? getLiveRangeForCurrent : () => null}
        onNavigate={onNavigate}
        onRemove={onRemove}
        onSendOne={onSendOne}
        onUnsend={onUnsend}
        closeMenu={closeMenu}
      />
    </MenuSection>
  );
}

function SentSection({
  views,
  total,
  currentFilePath,
  onClearSent,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSendOne,
  onUnsend,
  closeMenu,
}: {
  views: ScopeView[];
  total: number;
  currentFilePath: string;
  onClearSent: (scope?: string) => void;
} & RowHandlers) {
  return (
    <MenuSection
      title="Sent"
      dotClass="bg-muted-foreground/40"
      count={String(total)}
      defaultOpen={false}
      actions={
        <SectionAction
          label="Clear"
          title={`Clear ${total} sent comment${total !== 1 ? 's' : ''}`}
          icon={<Trash2 size={10} strokeWidth={2.2} />}
          tone="destructive"
          onClick={() => onClearSent()}
        />
      }
    >
      {views.map((v) => (
        <div key={v.scope} className="mt-1 first:mt-0">
          <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
            <span className="text-[9px] uppercase tracking-wider font-medium text-muted-fade-50">
              {v.label}
            </span>
            <span className="text-[9px] text-muted-fade-40 tabular-nums">{v.count}</span>
            {views.length > 1 && (
              <button
                type="button"
                onClick={() => onClearSent(v.scope)}
                title={`Clear ${v.count} sent comment${v.count !== 1 ? 's' : ''} in ${v.label}`}
                className="ml-auto shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-medium text-muted-fade-55 hover:text-destructive hover:bg-destructive/10 transition"
              >
                <Trash2 size={9} strokeWidth={2.2} />
                Clear
              </button>
            )}
          </div>
          <FileGroups
            comments={v.comments}
            scope={v.scope}
            firstPath={currentFilePath}
            currentFilePath={v.isCurrent ? currentFilePath : null}
            getLiveRangeForCurrent={v.isCurrent ? getLiveRangeForCurrent : () => null}
            onNavigate={onNavigate}
            onRemove={onRemove}
            onSendOne={onSendOne}
            onUnsend={onUnsend}
            closeMenu={closeMenu}
          />
        </div>
      ))}
    </MenuSection>
  );
}
