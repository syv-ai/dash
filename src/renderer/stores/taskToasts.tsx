import { toast } from 'sonner';
import type { LinkedItem } from '../../shared/types';

/** Toast shown after a task is created with linked issues/work-items whose
 *  context will be injected by the SessionStart hook. */
export function notifyContextInjected(linkedItems: LinkedItem[]) {
  const maxVisible = 3;
  const visible = linkedItems.slice(0, maxVisible);
  const overflow = linkedItems.length - maxVisible;
  toast(
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Context injected</span>
      {visible.map((item) => (
        <a
          key={`${item.provider}-${item.id}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
        >
          #{item.id}
        </a>
      ))}
      {overflow > 0 && <span className="text-[10px] text-muted-foreground">+{overflow} more</span>}
    </div>,
  );
}
