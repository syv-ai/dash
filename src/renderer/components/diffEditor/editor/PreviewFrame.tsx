import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { roleColor } from '../monacoTheme';
import { previewDocument, type PreviewKind, type PreviewPalette } from './previewDocument';
import { usePreviewImages } from './usePreviewImages';

interface PreviewFrameProps {
  kind: PreviewKind;
  /** The editor's root and the file's path in it: its relative images
   *  resolve from the file's folder (`usePreviewImages`). */
  cwd: string;
  filePath: string;
  /** The file's text (the live buffer, so unsaved edits show). */
  text: string;
  isDark: boolean;
  /** The editor's background, which the Markdown page takes. */
  background: string | undefined;
}

/** A role token resolved from the page; empty (the declaration then drops,
 *  leaving the browser's default) when it can't be read. */
const token = (name: string) => roleColor(name, '');

/** Dash's role tokens as the preview document wants them (read when the
 *  theme changes, as the Monaco theme reads them). */
function palette(isDark: boolean, background: string | undefined): PreviewPalette {
  return {
    dark: isDark,
    ground: background ?? token('--well'),
    ink: token('--ink'),
    muted: token('--ink-2'),
    line: token('--line'),
    codeBg: token('--select'),
    link: token('--link'),
    codeInk: token('--code-ink'),
  };
}

/**
 * A file rendered from its text (Markdown or HTML), untrusted content shown
 * in a sandboxed iframe: no `allow-same-origin` (an opaque origin: no
 * access to Dash, its storage or `window.electronAPI`), no `allow-scripts`
 * and no `allow-forms`. `allow-popups` only lets a link's click become a
 * window-open request, which main sends to the browser (http(s) only) and
 * denies; main also stops the frame navigating anywhere (`window.ts`). The
 * document's own CSP blocks the network (`previewDocument`): a relative
 * image comes inlined, read through main (`usePreviewImages`). HTML shows as
 * authored on a neutral white page, as a browser shows it.
 */
export function PreviewFrame({ kind, cwd, filePath, text, isDark, background }: PreviewFrameProps) {
  const images = usePreviewImages(cwd, filePath, kind, text);
  const doc = useMemo(
    () => previewDocument(kind, text, palette(isDark, background), images),
    [kind, text, isDark, background, images],
  );
  // The frame mounts only while it has a size: one made out of sight (the
  // narrow sidebar keeps the editor mounted, hidden) never painted once shown.
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setShown(width > 0 && height > 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="h-full w-full">
      {shown && (
        <iframe
          title={kind === 'html' ? 'HTML preview' : 'Markdown preview'}
          srcDoc={doc}
          sandbox="allow-popups"
          className={cn('h-full w-full border-0', kind === 'html' && 'bg-white')}
        />
      )}
    </div>
  );
}
