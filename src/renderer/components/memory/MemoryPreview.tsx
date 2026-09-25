import { useCallback, useMemo, useRef } from 'react';
import type { MemoryEntry } from '../../../shared/types';
import { markdownToDocument } from '../diffEditor/editor/markdownPreview';
import { MEMORY_LINK_PREFIX, MEMORY_PREVIEW_HEAD, rewriteMemoryLinks } from './memoryView';

interface Props {
  markdown: string;
  entries: MemoryEntry[];
  isDark: boolean;
  onOpenMemory: (file: string) => void;
}

/**
 * Rendered memory in a sandboxed iframe that runs no scripts at all (memory
 * text is untrusted). The renderer CSP (`script-src 'self'`) is inherited by
 * srcdoc frames, so an in-frame link bridge can't run anyway; instead the
 * frame keeps same-origin and this component wires its document from outside:
 * memory links open in the modal, Esc reaches the modal's close handler.
 */
export function MemoryPreview({ markdown, entries, isDark, onOpenMemory }: Props) {
  const html = useMemo(
    () => markdownToDocument(rewriteMemoryLinks(markdown, entries), isDark, MEMORY_PREVIEW_HEAD),
    [markdown, entries, isDark],
  );
  // Read through a ref so a re-render doesn't need the listeners re-attached.
  const openRef = useRef(onOpenMemory);
  openRef.current = onOpenMemory;

  const wireDocument = useCallback((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (e) => {
      const link = (e.target as Element | null)?.closest?.(`a[href^="${MEMORY_LINK_PREFIX}"]`);
      if (!link) return;
      e.preventDefault();
      const href = link.getAttribute('href') ?? '';
      openRef.current(decodeURIComponent(href.slice(MEMORY_LINK_PREFIX.length)));
    });
    // Keys pressed while the preview has focus never reach the parent window;
    // re-dispatch Esc from the frame element so Modal's handler sees it.
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  }, []);

  return (
    <iframe
      title="Memory preview"
      srcDoc={html}
      sandbox="allow-same-origin allow-popups"
      onLoad={(e) => wireDocument(e.currentTarget)}
      className="h-full w-full border-0"
    />
  );
}
