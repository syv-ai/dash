export function LoadingPill() {
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[hsl(var(--surface-2)/0.85)] backdrop-blur-sm shadow-sm">
      <div className="w-2.5 h-2.5 border-[1.5px] border-primary/30 border-t-primary rounded-full animate-spin" />
      <span className="text-[10px] text-muted-foreground/70">Loading</span>
    </div>
  );
}
