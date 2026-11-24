import { Loader2 } from 'lucide-react';

export function LoadingPill() {
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[hsl(var(--surface-2)/0.85)] shadow-xs">
      <Loader2 size={10} className="animate-spin text-primary" />
      <span className="text-xs text-muted-fade-70">Loading</span>
    </div>
  );
}
