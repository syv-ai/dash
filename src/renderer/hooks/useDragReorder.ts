import { useRef, useState, useCallback } from 'react';

interface DragHandlers {
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

interface UseDragReorderReturn<T extends { id: string }> {
  draggingId: string | null;
  getDragHandlers: (itemId: string, items: T[], groupId?: string) => DragHandlers;
}

/**
 * Reusable drag-to-reorder hook. Manages drag state and produces
 * handlers for each draggable item.
 *
 * @param onReorder  Called on every dragOver to show the preview reorder.
 * @param onCommit   Called on successful drop to persist the new order.
 *                   Receives (groupId, reorderedItems). groupId is undefined
 *                   for ungrouped lists (e.g. rotation).
 * @param getItems   Returns the current items for a given groupId (used in
 *                   onDragEnd to read the final state after preview reorders).
 */
export function useDragReorder<T extends { id: string }>({
  onReorder,
  onCommit,
  getItems,
}: {
  onReorder: (groupId: string | undefined, reordered: T[]) => void;
  onCommit?: (groupId: string | undefined, reordered: T[]) => void;
  getItems: (groupId: string | undefined) => T[];
}): UseDragReorderReturn<T> {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const dragGroupIdRef = useRef<string | undefined>(undefined);
  const initialOrderRef = useRef<string[] | null>(null);
  const didDropRef = useRef(false);

  const getDragHandlers = useCallback(
    (itemId: string, items: T[], groupId?: string): DragHandlers => ({
      onDragStart(e) {
        dragIdRef.current = itemId;
        dragGroupIdRef.current = groupId;
        initialOrderRef.current = items.map((t) => t.id);
        didDropRef.current = false;
        setDraggingId(itemId);
        e.dataTransfer.effectAllowed = 'move';
        const el = e.currentTarget;
        e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
      },

      onDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const fromId = dragIdRef.current;
        if (!fromId || fromId === itemId) return;
        if (dragGroupIdRef.current !== groupId) return;
        const fromIdx = items.findIndex((t) => t.id === fromId);
        const toIdx = items.findIndex((t) => t.id === itemId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
        const reordered = [...items];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        onReorder(groupId, reordered);
      },

      onDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        didDropRef.current = true;
      },

      onDragEnd() {
        const gId = dragGroupIdRef.current;
        const initialOrder = initialOrderRef.current;
        const didDrop = didDropRef.current;
        dragIdRef.current = null;
        dragGroupIdRef.current = undefined;
        initialOrderRef.current = null;
        didDropRef.current = false;
        setDraggingId(null);

        if (!initialOrder) return;
        const finalItems = getItems(gId);
        const finalIds = finalItems.map((t) => t.id);
        const unchanged =
          finalIds.length === initialOrder.length &&
          finalIds.every((id, i) => id === initialOrder[i]);

        if (!didDrop && !unchanged) {
          // Cancelled drag (Esc / dropped outside): revert
          const byId = new Map(finalItems.map((t) => [t.id, t]));
          const reverted = initialOrder.map((id) => byId.get(id)).filter((t): t is T => !!t);
          onReorder(gId, reverted);
          return;
        }
        if (unchanged) return;
        onCommit?.(gId, finalItems);
      },
    }),
    [onReorder, onCommit, getItems],
  );

  return { draggingId, getDragHandlers };
}
