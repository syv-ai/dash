import { useUi } from '../stores/uiStore';

/** A drawer's open state, kept for the session under `id` (shared across
 *  tasks, so "Feedback" folded in one task stays folded in the next),
 *  `defaultOpen` until the person folds or unfolds it. Spread into a
 *  collapsible `DetailSection`. */
export function useSectionOpen(
  id: string,
  defaultOpen: boolean,
): { open: boolean; onOpenChange: (open: boolean) => void } {
  const open = useUi((s) => s.sectionsOpen[id] ?? defaultOpen);
  return { open, onOpenChange: (o) => useUi.getState().setSectionOpen(id, o) };
}
