import React, { useMemo } from 'react';
import { buildTree } from './buildTree';
import { TreeNodeView } from './TreeNode';
import type { FileChange } from '../../../shared/types';

interface FileTreeViewProps {
  files: FileChange[];
  /** Per-file stage toggle (called from FileRow checkbox). */
  onToggleFileStage: (file: FileChange) => void;
  /** Batched stage toggle for folder rows — receives every descendant path. */
  onToggleFolderStage: (paths: string[]) => void;
  onViewDiff: (file: FileChange) => void;
  /** Per-file discard (FileRow hover button). */
  onDiscard: (file: FileChange) => void;
  /** Batched discard for folder rows. */
  onDiscardMany: (paths: string[]) => void;
  onAddToGitignore: (path: string) => void;
}

export function FileTreeView({
  files,
  onToggleFileStage,
  onToggleFolderStage,
  onViewDiff,
  onDiscard,
  onDiscardMany,
  onAddToGitignore,
}: FileTreeViewProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <TreeNodeView
        node={tree}
        indent={0}
        onToggleFileStage={onToggleFileStage}
        onToggleFolderStage={(node) => {
          const collect: string[] = [];
          (function walk(n) {
            for (const file of n.files) collect.push(file.path);
            for (const child of n.children.values()) walk(child);
          })(node);
          onToggleFolderStage(collect);
        }}
        onViewDiff={onViewDiff}
        onDiscard={onDiscard}
        onDiscardMany={onDiscardMany}
        onAddToGitignore={onAddToGitignore}
      />
    </div>
  );
}
