interface Props {
  message: string;
  onRetry(): void;
  onDismiss(): void;
}

export function SaveErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-destructive/40 bg-destructive/10 text-[11px] shrink-0">
      <span className="text-destructive truncate" title={message}>
        Couldn’t save: {message}
      </span>
      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={onRetry}
          className="px-2 py-1 rounded-md text-[11px] bg-destructive/15 text-destructive hover:bg-destructive/25"
        >
          Retry
        </button>
        <button
          onClick={onDismiss}
          className="px-2 py-1 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
