import type { LinkedItem } from '../../shared/types';
import { toast } from '../components/ui/toast';

/** Toast shown after a task is created with linked issues/work-items whose
 *  context will be injected by the SessionStart hook. The ids are plain text:
 *  the links already sit on the task. */
export function notifyContextInjected(linkedItems: LinkedItem[]) {
  const maxVisible = 3;
  const ids = linkedItems.slice(0, maxVisible).map((item) => `#${item.id}`);
  const overflow = linkedItems.length - maxVisible;
  if (overflow > 0) ids.push(`+${overflow} more`);
  toast.info('Context injected', { meta: ids.join(' ') });
}
