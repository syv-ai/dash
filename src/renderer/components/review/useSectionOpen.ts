import { useUi } from '../../stores/uiStore';

/** A review section's open state, kept for the session under `id` (shared
 *  across tasks), `defaultOpen` until the person folds or unfolds it. Spread
 *  into a collapsible `DetailSection`. */
export function useSectionOpen(
  id: string,
  defaultOpen: boolean,
): { open: boolean; onOpenChange: (open: boolean) => void } {
  const open = useUi((s) => s.reviewSections[id] ?? defaultOpen);
  return { open, onOpenChange: (o) => useUi.getState().setReviewSectionOpen(id, o) };
}
