import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

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
  children: React.ReactNode;
}

// Topmost modal owns Esc. When a modal opens inside another modal, the inner
// pushes onto this stack so the outer's keydown handler bows out for Esc.
const modalCloseStack: Array<() => void> = [];

export function Modal({ onClose, size, overflow = 'hidden', cardStyle, children }: ModalProps) {
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
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
        // editor's comment textarea: it handles Esc to cancel the draft.
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-radix-popper-content-wrapper]')) {
          return;
        }
        if (target?.closest('[data-diff-comment-input]')) {
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
      {/* Local backdrop instead of the shared `modal-backdrop` class: a slightly
          softer dim + blur lets the underlying app peek through the translucent
          card without dominating it. */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-[hsl(0_0%_0%/0.55)] backdrop-blur-md ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onMouseDown={(e) => {
          mouseDownOnBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
            requestClose();
          }
          mouseDownOnBackdrop.current = false;
        }}
        onAnimationEnd={() => {
          if (closing) onClose();
        }}
      >
        <div
          className={`modal-shell border border-border/40 rounded-xl ${size} flex flex-col ${overflow === 'visible' ? 'overflow-visible' : 'overflow-hidden'} ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalCloseContext.Provider>
  );
}
