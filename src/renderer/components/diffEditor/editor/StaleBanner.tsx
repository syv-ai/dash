interface Props {
  onOverwrite(): void;
  onReload(): void;
  onCancel(): void;
}

export function StaleBanner({ onOverwrite, onReload, onCancel }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-amber-500/40 bg-amber-500/10 text-[11px] flex-shrink-0">
      <span className="text-amber-700 dark:text-amber-300">
        This file changed on disk since you opened it.
      </span>
      <div className="flex gap-1.5">
        <button
          onClick={onOverwrite}
          className="px-2 py-1 rounded-md text-[11px] bg-destructive/15 text-destructive hover:bg-destructive/25"
        >
          Overwrite
        </button>
        <button
          onClick={onReload}
          className="px-2 py-1 rounded-md text-[11px] bg-accent hover:bg-accent/80"
        >
          Reload from disk
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
