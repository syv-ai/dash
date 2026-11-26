import * as React from 'react';
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ListRow, type ListRowProps } from './ListRow';
import { VirtualList, type VirtualListHandle } from './VirtualList';
import { LIST_MOTION_MS } from './VirtualListMotion';
import { tabStopKey, treeKey, type TreeNode } from './treeNav';

const VARIANTS = {
  panel: { className: '', gap: 0 },
  sidebar: { className: 'px-2 pt-1 pb-3', gap: 1 },
} as const;

/** What `Tree` hands each row it renders. */
export interface TreeRowContext {
  /** The row as the keys see it: its key, depth, open state. */
  node: TreeNode;
  selected: boolean;
  /** The roving tab stop: the one row Tab lands on. */
  tabStop: boolean;
  rowRef: (el: HTMLElement | null) => void;
  /** The row took focus (a click, Tab): it becomes the tab stop. */
  onFocusRow: () => void;
}

/** `nodeOf` for rows that carry their own `TreeNode` fields. */
export const ownNode = (row: TreeNode): TreeNode => row;

export interface TreeHandle {
  /** Focus row `index`, scrolling it into view (it may not be rendered yet). */
  focusRow(index: number): void;
  /** Bring row `index` into view, focus left where it is. */
  scrollToRow(index: number): void;
}

export interface TreeProps<R> {
  /** Every row on show, in order: the tree flattened (a closed branch's
   *  children left out), headings and gaps included. */
  rows: readonly R[];
  /** A row as the keys see it (identity for rows that are `TreeNode`s). */
  nodeOf: (row: R) => TreeNode;
  /** The row that reads as current (select tint, the default tab stop). */
  isSelected: (row: R, index: number) => boolean;
  /** Open or close a branch (Right, Left). The caller owns which are open. */
  onToggle: (row: R, index: number) => void;
  /** Renders a row; an item spreads `ctx` into a `TreeRow`. */
  renderRow: (row: R, ctx: TreeRowContext, index: number) => React.ReactNode;
  /** A row's height before it is measured. */
  estimateSize: (row: R) => number;
  handleRef?: React.Ref<TreeHandle>;
  /** Layout only: size the scroller (`min-h-0 flex-1`). */
  className?: string;
  /** `panel` (a sidebar panel's tree: Files, the editor modal) or `sidebar`
   *  (the app sidebar's lists: wider gutters, a pixel between rows). */
  variant?: keyof typeof VARIANTS;
  /** 8px above the first row, when nothing heads the tree. */
  gapAbove?: boolean;
  'aria-label'?: string;
}

/**
 * The app's one tree: the file trees and the left sidebar's projects and
 * tasks. Rows come in flat (the caller flattens its own model, `TreeNode`
 * for the keys) and are windowed, so a repo-sized tree stays light. Rows
 * move calmly as they change (`VirtualList`'s `animate`, T14): a branch's
 * rows uncover as it opens, rows slide to a new place, removed rows cover. The tree
 * owns focus (one tab stop, moved by the arrow keys; `ui/treeNav`) and the
 * selection's tint; the caller owns the rows, which branches are open, and
 * every row's look, through `TreeRow` and its slots.
 */
export function Tree<R>({
  rows,
  nodeOf,
  isSelected,
  onToggle,
  renderRow,
  estimateSize,
  handleRef,
  className,
  variant = 'panel',
  gapAbove,
  'aria-label': ariaLabel,
}: TreeProps<R>) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  /** A row to focus once it renders (it may be scrolled out of the window). */
  const pendingFocus = useRef<string | null>(null);

  const nodes = useMemo(() => rows.map(nodeOf), [rows, nodeOf]);
  const keys = useMemo(() => nodes.map((n) => n.key), [nodes]);
  const focusRow = (index: number) => {
    const key = nodes[index]!.key;
    setFocusKey(key);
    pendingFocus.current = key;
    listRef.current?.scrollToIndex(index);
  };
  useImperativeHandle(handleRef, () => ({
    focusRow,
    scrollToRow: (index) => listRef.current?.scrollToIndex(index),
  }));
  useEffect(() => {
    const key = pendingFocus.current;
    const el = key && elements.current.get(key);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
  });

  const selectedIndex = rows.findIndex((r, i) => isSelected(r, i));
  const tabStop = tabStopKey(nodes, focusKey, selectedIndex);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const index = nodes.findIndex((n) => n.key === (e.target as HTMLElement).dataset.key);
    if (index < 0) return;
    const action = treeKey(nodes, index, e.key);
    if (!action) return;
    e.preventDefault();
    if ('focus' in action) focusRow(action.focus);
    else onToggle(rows[action.toggle]!, action.toggle);
  };

  return (
    <VirtualList
      role="tree"
      aria-label={ariaLabel}
      handleRef={listRef}
      onKeyDown={onKeyDown}
      className={cn(VARIANTS[variant].className, className)}
      gapAbove={gapAbove}
      gap={VARIANTS[variant].gap}
      keys={keys}
      animate
      estimateSize={(i) => estimateSize(rows[i]!)}
    >
      {(i) => {
        const row = rows[i]!;
        const node = nodes[i]!;
        return renderRow(
          row,
          {
            node,
            selected: i === selectedIndex || isSelected(row, i),
            tabStop: node.key === tabStop,
            onFocusRow: () => setFocusKey(node.key),
            rowRef: (el) => {
              if (el) elements.current.set(node.key, el);
              else elements.current.delete(node.key);
            },
          },
          i,
        );
      }}
    </VirtualList>
  );
}

export type TreeRowProps = Omit<ListRowProps, 'as' | 'indent' | 'selected' | 'ref'> & {
  ctx: TreeRowContext;
  /** A click, or Enter / Space on the row itself (a control inside handles
   *  its own keys): open a file, toggle a folder, select a task. */
  onActivate: (e: React.MouseEvent | React.KeyboardEvent) => void;
  /** Space's own action (Files: stage); absent, Space activates like Enter. */
  onSpace?: () => void;
  ref?: React.Ref<HTMLElement>;
};

/**
 * A tree's row: `ListRow` with the tree's semantics (treeitem, level,
 * expanded, the roving tab stop), its depth's indent, a branch's chevron
 * (unless `leading` takes the slot) and Enter / Space. Everything a tree
 * varies is a `ListRow` prop or slot: `trailing`, `description`, `dimmed`,
 * `changed`, `dragging`, `indentStep`, drag handlers.
 */
export function TreeRow({
  ctx,
  onActivate,
  onSpace,
  leading,
  ref,
  onKeyDown,
  ...props
}: TreeRowProps) {
  const { node } = ctx;
  const branch = node.open !== undefined;
  const setRef = (el: HTMLElement | null) => {
    ctx.rowRef(el);
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.RefObject<HTMLElement | null>).current = el;
  };
  return (
    <ListRow
      as="div"
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={node.open}
      aria-selected={branch ? undefined : ctx.selected}
      tabIndex={ctx.tabStop ? 0 : -1}
      data-key={node.key}
      selected={ctx.selected}
      indent={node.depth}
      leading={leading ?? (branch ? <BranchChevron open={!!node.open} /> : undefined)}
      {...props}
      ref={setRef}
      onFocus={(e: React.FocusEvent) => e.target === e.currentTarget && ctx.onFocusRow()}
      onClick={(e: React.MouseEvent) => onActivate(e)}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        if (e.key === ' ' && onSpace) onSpace();
        else onActivate(e);
      }}
    />
  );
}

/** A branch's chevron: points right, turns down as the branch opens, in
 *  step with its rows (`LIST_MOTION_MS`, `ease-calm`). `TreeRow` draws it;
 *  a row with its own chevron button puts it inside. */
export function BranchChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={14}
      strokeWidth={1.8}
      // Tailwind v4's rotate-* sets `rotate`, not `transform`.
      className={cn(
        'transition-[rotate] ease-calm motion-reduce:transition-none',
        open && 'rotate-90',
      )}
      style={{ transitionDuration: `${LIST_MOTION_MS}ms` }}
    />
  );
}

/** A group's heading inside a tree ("Staged · 3", "Favourites"): not an
 *  item, so the keys pass over it (give its row depth -1, not focusable). */
export function TreeHeading({ children }: { children: React.ReactNode }) {
  return (
    <div role="presentation" className="type-subheading px-2.5 pt-2 pb-1">
      {children}
    </div>
  );
}
