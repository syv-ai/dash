import React, { useMemo, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { buildTree, collectFiles } from './buildTree';
import { flattenTree, type FlatRow } from './flattenTree';
import { folderActions, type Callbacks } from './TreeNode';
import { FileRow } from './FileRow';
import { FolderRow } from './FolderRow';
import type { FileChange } from '../../../shared/types';

/** Above this many changed files the panel renders this list instead of the animated tree. */
export const VIRTUALIZE_THRESHOLD = 300;

const ROW_ESTIMATE_PX = 26;

export interface FileSection extends Omit<Callbacks, 'onToggleFolderStage'> {
  id: string;
  label: string;
  files: FileChange[];
  onToggleFolderStage: (paths: string[]) => void;
}

type Row = FlatRow | { kind: 'header'; key: string; label: string };

interface VirtualFileListProps {
  sections: FileSection[];
  /** Changes whenever any section's files do (the store's status object); the trees rebuild on it. */
  filesVersion: unknown;
  /** The element that scrolls the list. */
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * The staged and unstaged trees as one windowed list: only the rows in view
 * are mounted, so a worktree with tens of thousands of changed files stays
 * light. Same rows, collapse defaults and truncation as the animated tree,
 * without its enter/exit animations.
 */
export function VirtualFileList({ sections, filesVersion, scrollRef }: VirtualFileListProps) {
  const [open, setOpen] = useState<Map<string, boolean>>(() => new Map());
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());

  const trees = useMemo(
    () => sections.map((s) => ({ section: s, tree: buildTree(s.files) })),
    // Rebuild only when the files change, not on every parent render (the
    // panel re-derives its file arrays and callbacks each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filesVersion],
  );
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const rows = useMemo(() => {
    const out: { row: Row; sectionId: string }[] = [];
    for (const { section, tree } of trees) {
      const prefix = `${section.id}:`;
      out.push({
        row: { kind: 'header', key: `${prefix}header`, label: section.label },
        sectionId: section.id,
      });
      const state = {
        open: new Map(
          [...open]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => [k.slice(prefix.length), v]),
        ),
        showAll: new Set(
          [...showAll].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
        ),
      };
      for (const row of flattenTree(tree, state, prefix)) out.push({ row, sectionId: section.id });
    }
    return out;
  }, [trees, open, showAll]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (i) => rows[i]!.row.key,
    overscan: 12,
    paddingStart: 4,
    paddingEnd: 4,
  });

  const renderRow = (row: Row, section: FileSection) => {
    switch (row.kind) {
      case 'header':
        return (
          <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {row.label}
          </div>
        );
      case 'file':
        return (
          <div className="px-1 pb-0.5">
            <FileRow
              file={row.file}
              indent={row.indent}
              animated={false}
              onToggleStage={section.onToggleFileStage}
              onViewDiff={section.onViewDiff}
              onDiscard={section.onDiscard}
              onAddToGitignore={section.onAddToGitignore}
            />
          </div>
        );
      case 'folder': {
        const { terminal } = row;
        const { discardable, canDiscard, canIgnore } = folderActions(terminal);
        const openKey = `${section.id}:${terminal.path}`;
        return (
          <div className="px-1 pb-0.5">
            <FolderRow
              displayName={row.display}
              agg={terminal.agg}
              indent={row.indent}
              open={row.open}
              onToggleOpen={() => setOpen((m) => new Map(m).set(openKey, !row.open))}
              onToggleStage={() =>
                section.onToggleFolderStage(collectFiles(terminal).map((f) => f.path))
              }
              canDiscard={canDiscard}
              folderBasePath={terminal.path}
              discardPaths={discardable.map((f) => f.path)}
              onDiscard={() => section.onDiscardMany(discardable.map((f) => f.path))}
              canIgnore={canIgnore}
              onAddToGitignore={() => {
                if (terminal.path) section.onAddToGitignore(`${terminal.path}/`);
              }}
            />
          </div>
        );
      }
      case 'more':
        return (
          <div className="px-1 pb-0.5">
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground italic">
              <span className="flex-1">+{row.hidden} more in this folder</span>
              <button
                onClick={() => setShowAll((s) => new Set(s).add(`${section.id}:${row.folderPath}`))}
                className="text-primary text-[11px] hover:underline"
              >
                Show all
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const { row, sectionId } = rows[item.index]!;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {renderRow(row, sectionById.get(sectionId)!)}
          </div>
        );
      })}
    </div>
  );
}
