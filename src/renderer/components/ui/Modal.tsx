import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { MOTION_MS, reducedMotion } from '../../lib/motion';

// Lets nested close buttons (Settings's sidebar X, Skills's header X) trigger the
// fade-out + scale-out animation instead of calling the parent's onClose directly,
// which would unmount the modal mid-animation.
const ModalCloseContext = createContext<(() => void) | undefined>(undefined);

/** Use inside a <Modal>. Returns the animated close fn — backs out via fade-out and
 *  scale-out before unmounting. Throws if called outside <Modal>; use
 *  useCloseHandler for components that render both inside and outside Modal. */
export function useModalClose(): () => void {
  const ctx = useContext(ModalCloseContext);
  if (!ctx) {
    throw new Error('useModalClose must be called from inside <Modal>');
  }
  return ctx;
}

/** Like useModalClose, but for components that may render in both modal and
 *  non-modal contexts. Returns the animated close fn when inside <Modal>,
 *  otherwise the supplied fallback (typically the parent's onClose prop,
 *  which dismisses immediately). */
export function useCloseHandler(fallback: () => void): () => void {
  return useContext(ModalCloseContext) ?? fallback;
}

interface ModalProps {
  onClose: () => void;
  /** Asked before any close starts (Escape, backdrop, a close button); false
   *  keeps the modal open, e.g. over unsaved edits. */
  canClose?: () => boolean | Promise<boolean>;
  /** Tailwind sizing for the card. Required — every caller decides its own footprint
   *  so we never silently coerce a small confirm dialog into a Settings-sized panel. */
  size: string;
  /** Card overflow. Default 'hidden'; use 'visible' when internal content (e.g. a
   *  dropdown positioned absolutely from inside the modal) needs to escape the
   *  card's rounded bounds. */
  overflow?: 'hidden' | 'visible';
  /** Inline style merged onto the card div. Use for one-off overrides (e.g.
   *  a more transparent background) — beats class-based bg utilities. */
  cardStyle?: React.CSSProperties;
  /** Raise the backdrop above the default z-50 so this modal stacks over
   *  another already-open modal (e.g. the commit graph opened from the diff
   *  editor's blame card). */
  elevated?: boolean;
  /** Where the card sits. `center` (default) centres it; `top` pins its top a
   *  fixed offset down and grows it downward, so a card that grows as you
   *  type (rows appearing under an input) never moves the input. */
  anchor?: 'center' | 'top';
  children: React.ReactNode;
}

// The exit runs on `--motion-calm` (`animate-fade-out`/`animate-scale-out`);
// past it plus a margin the modal closes even if no `animationend` arrives (a
// window that wasn't painting, an animation cut short).
const EXIT_FALLBACK_MS = MOTION_MS.calm + 200;

// Topmost modal owns Esc. When a modal opens inside another modal, the inner
// pushes onto this stack so the outer's keydown handler bows out for Esc.
const modalCloseStack: Array<() => void> = [];

export function Modal({
  onClose,
  canClose,
  size,
  overflow = 'hidden',
  cardStyle,
  elevated = false,
  anchor = 'center',
  children,
}: ModalProps) {
  const [closing, setClosing] = useState(false);
  // The latest onClose, called once however the exit ends (animation, the
  // fallback timer, or at once under reduced motion).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closed = useRef(false);
  const finishClose = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current();
  }, []);
  const startClose = useCallback(() => {
    // Reduced motion has no exit to wait for: a 0s animation's end event isn't
    // guaranteed, and waiting on it once left an invisible backdrop over the app.
    if (reducedMotion()) finishClose();
    else setClosing(true);
  }, [finishClose]);
  const requestClose = useCallback(() => {
    if (!canClose) return startClose();
    void Promise.resolve(canClose()).then((ok) => ok && startClose());
  }, [canClose, startClose]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(finishClose, EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [closing, finishClose]);
  // Backdrop click should ONLY close when both mousedown and mouseup land on
  // the backdrop itself. Without this, a drag that starts on a card child
  // (e.g. a react-resizable-panels handle) and releases outside the card
  // synthesizes a click event on the backdrop and the modal closes mid-drag.
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    modalCloseStack.push(requestClose);
    return () => {
      const i = modalCloseStack.indexOf(requestClose);
      if (i >= 0) modalCloseStack.splice(i, 1);
    };
  }, [requestClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        // Let a Radix popover own the Esc when focus is inside it — its
        // onEscapeKeyDown will close just the popover. Same for the diff-
        // editor's comment textarea: it handles Esc to cancel the draft, and
        // for a field whose suggestion list is open (`data-owns-escape`).
        // A keydown can target `document` (no element focused), which has no `closest`.
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('[data-radix-popper-content-wrapper]')) {
          return;
        }
        if (target?.closest('[data-diff-comment-input], [data-owns-escape="true"]')) {
          return;
        }
        // Only the topmost modal responds — keeps a nested dialog from
        // cascade-closing its parent.
        if (modalCloseStack[modalCloseStack.length - 1] !== requestClose) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    };
    // Capture phase so the modal wins over xterm/pty listeners deeper in the tree.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [requestClose]);

  return (
    <ModalCloseContext.Provider value={requestClose}>
      {/* The scrim token dims the app behind; it is dark ink in the light theme. */}
      <div
        className={cn(
          'fixed inset-0 flex justify-center bg-scrim',
          // Top: 10vh down, which with a dialog's 86vh cap still fits the window.
          anchor === 'top' ? 'items-start pt-[10vh]' : 'items-center',
          elevated ? 'z-[60]' : 'z-50',
          closing ? 'animate-fade-out' : 'animate-fade-in',
        )}
        onMouseDown={(e) => {
          mouseDownOnBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
            requestClose();
          }
          mouseDownOnBackdrop.current = false;
        }}
        onAnimationEnd={(e) => {
          // Only the backdrop's own fade ends the exit, not a child's animation.
          if (closing && e.target === e.currentTarget) finishClose();
        }}
      >
        {/* no-drag: Electron applies the titlebar's drag region regardless of
            stacking, so without it a tall modal's top edge (the diff editor's
            header buttons) sits under the drag strip and swallows clicks. */}
        <div
          className={cn(
            'titlebar-no-drag relative flex flex-col rounded-2xl bg-dialog text-ink shadow-raised',
            size,
            overflow === 'visible' ? 'overflow-visible' : 'overflow-hidden',
            closing ? 'animate-scale-out' : 'animate-scale-in',
          )}
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalCloseContext.Provider>
  );
}
