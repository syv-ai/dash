import { useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { Button } from '../ui/Button';

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

/** A folder's discard, confirmed: the files it throws away, then Discard. */
export function DiscardFolderConfirm({
  folderName,
  folderBasePath,
  paths,
  onClose,
  onConfirm,
}: DiscardFolderConfirmProps) {
  const [busy, setBusy] = useState(false);
  const count = paths.length;
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
    <div className="flex w-80 flex-col gap-2.5 p-3">
      <div>
        <h4 className="type-heading">Discard folder</h4>
        <p className="type-caption mt-0.5 truncate">
          {folderName}/ · {count} {count === 1 ? 'file' : 'files'}
        </p>
      </div>
      <div className="scrollbar-thin-hover flex max-h-40 flex-col overflow-y-auto rounded-md bg-well p-1.5">
        {items.map((item) => (
          <div key={item.rel} className="type-body truncate px-1.5 py-0.5" title={item.rel}>
            {item.dir && <span className="text-ink-3">{item.dir}</span>}
            {item.base}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void handleConfirm()} disabled={busy}>
          {busy ? (
            <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
          ) : (
            <Undo2 size={14} strokeWidth={1.8} />
          )}
          {busy ? 'Discarding…' : 'Discard'}
        </Button>
      </div>
    </div>
  );
}
