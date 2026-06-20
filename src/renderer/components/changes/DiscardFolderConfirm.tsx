import React, { useState } from 'react';
import { Undo2, Loader2 } from 'lucide-react';

interface DiscardFolderConfirmProps {
  folderName: string;
  /** Full repo-relative path of the folder, used to strip the prefix off each file path. */
  folderBasePath: string;
  /** Full repo-relative paths of every file that will be discarded. */
  paths: string[];
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

function splitRelative(fullPath: string, folderBasePath: string) {
  const prefix = folderBasePath ? `${folderBasePath}/` : '';
  const rel = prefix && fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const idx = rel.lastIndexOf('/');
  return idx === -1
    ? { rel, base: rel, dir: '' }
    : { rel, base: rel.slice(idx + 1), dir: rel.slice(0, idx + 1) };
}

export function DiscardFolderConfirm({
  folderName,
  folderBasePath,
  paths,
  onClose,
  onConfirm,
}: DiscardFolderConfirmProps) {
  const [busy, setBusy] = useState(false);
  const totalCount = paths.length;
  const items = paths.map((p) => splitRelative(p, folderBasePath));

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-[320px] p-3 flex flex-col gap-2.5">
      <div>
        <h4 className="text-[12px] font-semibold text-foreground tracking-tight">Discard folder</h4>
        <p className="text-[11px] font-mono text-muted-foreground/80 truncate mt-0.5">
          {folderName}/{' '}
          <span className="text-muted-foreground/60">
            · {totalCount} {totalCount === 1 ? 'file' : 'files'}
          </span>
        </p>
      </div>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border/40 bg-[hsl(var(--surface-0))] p-1.5 flex flex-col">
        {items.map((item) => (
          <div
            key={item.rel}
            className="font-mono text-[11px] truncate py-0.5 px-1.5 rounded hover:bg-[hsl(var(--surface-2)/0.4)]"
            title={item.rel}
          >
            {item.dir && <span className="text-muted-foreground/60">{item.dir}</span>}
            <span className="text-foreground">{item.base}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-3 h-8 rounded-md text-[11.5px] text-muted-foreground/80 hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void handleConfirm();
          }}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 h-8 rounded-md text-[11.5px] font-medium bg-destructive text-destructive-foreground hover:brightness-110 transition-colors disabled:opacity-70 disabled:pointer-events-none"
        >
          {busy ? (
            <>
              <Loader2 size={11} strokeWidth={2.5} className="animate-spin" />
              Discarding…
            </>
          ) : (
            <>
              <Undo2 size={11} strokeWidth={2.5} />
              Discard
            </>
          )}
        </button>
      </div>
    </div>
  );
}
