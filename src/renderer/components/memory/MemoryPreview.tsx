import { useEffect, useMemo, useRef } from 'react';
import type { MemoryEntry } from '../../../shared/types';
import { markdownToDocument } from '../diffEditor/editor/markdownPreview';
import { MEMORY_LINK_MESSAGE, MEMORY_PREVIEW_HEAD, rewriteMemoryLinks } from './memoryView';

interface Props {
  markdown: string;
  entries: MemoryEntry[];
  isDark: boolean;
  onOpenMemory: (file: string) => void;
}

/**
 * Rendered memory in the same sandboxed iframe as the editor's markdown
 * preview (scripts on, no same-origin — memory text is untrusted). Memory
 * links come back as postMessage; only messages from this iframe count.
 */
export function MemoryPreview({ markdown, entries, isDark, onOpenMemory }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(
    () => markdownToDocument(rewriteMemoryLinks(markdown, entries), isDark, MEMORY_PREVIEW_HEAD),
    [markdown, entries, isDark],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: unknown; file?: unknown };
      if (data?.type === MEMORY_LINK_MESSAGE && typeof data.file === 'string') {
        onOpenMemory(data.file);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onOpenMemory]);

  return (
    <iframe
      ref={frameRef}
      title="Memory preview"
      srcDoc={html}
      sandbox="allow-scripts allow-popups"
      className="h-full w-full border-0"
    />
  );
}
