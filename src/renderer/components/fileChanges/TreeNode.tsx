import React, { useState } from 'react';
import { FolderRow } from './FolderRow';
import { FileRow } from './FileRow';
import { compressedDisplay, type TreeNode } from './buildTree';
import type { FileChange } from '../../../shared/types';

const SMART_COLLAPSE_THRESHOLD = 20;
const FOLDER_TRUNCATION_CAP = 30;

interface Callbacks {
  onToggleFileStage: (file: FileChange) => void;
  onToggleFolderStage: (node: TreeNode) => void;
  onViewDiff: (file: FileChange) => void;
  onDiscard: (file: FileChange) => void;
  onDiscardMany: (paths: string[]) => void;
  onAddToGitignore: (path: string) => void;
}

function collectFiles(node: TreeNode): FileChange[] {
  const out: FileChange[] = [];
  (function walk(n: TreeNode) {
    for (const f of n.files) out.push(f);
    for (const child of n.children.values()) walk(child);
  })(node);
  return out;
}

interface TreeNodeProps extends Callbacks {
  node: TreeNode;
  indent: number;
}

export function TreeNodeView({ node, indent, ...callbacks }: TreeNodeProps) {
  const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {children.map((child) => (
        <DirNode key={child.path} node={child} indent={indent} {...callbacks} />
      ))}
      <FileSection
        files={files}
        indent={indent}
        bigFolder={files.length > FOLDER_TRUNCATION_CAP}
        {...callbacks}
      />
    </>
  );
}

function DirNode({ node, indent, ...callbacks }: TreeNodeProps) {
  const { display, terminal } = compressedDisplay(node);
  const initiallyOpen = terminal.agg.count <= SMART_COLLAPSE_THRESHOLD;
  const [open, setOpen] = useState(initiallyOpen);
  const subtreeFiles = collectFiles(terminal);
  const discardable = subtreeFiles.filter((f) => !f.staged && f.status !== 'deleted');
  const canDiscard = discardable.length > 0;
  // Only pure-untracked folders can be safely .gitignored — mixing in tracked
  // content would suddenly ignore those too, which is rarely what the user wants.
  const canIgnore = terminal.agg.status === 'untracked';
  return (
    <>
      <FolderRow
        displayName={display}
        agg={terminal.agg}
        indent={indent}
        open={open}
        onToggleOpen={() => setOpen((v) => !v)}
        onToggleStage={() => callbacks.onToggleFolderStage(terminal)}
        canDiscard={canDiscard}
        folderBasePath={terminal.path}
        discardPaths={discardable.map((f) => f.path)}
        onDiscard={() => callbacks.onDiscardMany(discardable.map((f) => f.path))}
        canIgnore={canIgnore}
        onAddToGitignore={() => {
          const folderPath = terminal.path ? `${terminal.path}/` : '';
          if (folderPath) callbacks.onAddToGitignore(folderPath);
        }}
      />
      {open && <TreeNodeView node={terminal} indent={indent + 1} {...callbacks} />}
    </>
  );
}

interface FileSectionProps extends Callbacks {
  files: FileChange[];
  indent: number;
  bigFolder: boolean;
}

function FileSection({
  files,
  indent,
  bigFolder,
  onToggleFileStage,
  onViewDiff,
  onDiscard,
  onAddToGitignore,
}: FileSectionProps) {
  const [showAll, setShowAll] = useState(false);
  if (files.length === 0) return null;
  const truncate = bigFolder && !showAll && files.length > FOLDER_TRUNCATION_CAP;
  const visible = truncate ? files.slice(0, FOLDER_TRUNCATION_CAP) : files;
  return (
    <>
      {visible.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          indent={indent}
          onToggleStage={onToggleFileStage}
          onViewDiff={onViewDiff}
          onDiscard={onDiscard}
          onAddToGitignore={onAddToGitignore}
        />
      ))}
      {truncate && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground italic">
          <span className="flex-1">
            +{files.length - FOLDER_TRUNCATION_CAP} more in this folder
          </span>
          <button
            onClick={() => setShowAll(true)}
            className="text-primary text-[11px] hover:underline"
          >
            Show all
          </button>
        </div>
      )}
    </>
  );
}
