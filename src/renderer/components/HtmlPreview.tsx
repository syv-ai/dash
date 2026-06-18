import React from 'react';

interface HtmlPreviewProps {
  html: string;
}

/**
 * Render an HTML string in a sandboxed iframe via `srcDoc`. The sandbox grants
 * scripts/forms but deliberately omits `allow-same-origin`, so the preview
 * cannot reach the app's origin, storage, or `window.electronAPI`. It also omits
 * `allow-popups`/`allow-modals`: a static file preview has no need to open
 * windows, and `window.open` from previewed (agent-authored) HTML would otherwise
 * reach the app's window-open handler and force the OS to open an arbitrary URL.
 * Relative asset references won't resolve (no base URL) — self-contained pages
 * with inline or absolute/CDN resources render as expected.
 */
export function HtmlPreview({ html }: HtmlPreviewProps) {
  return (
    <iframe
      title="HTML preview"
      srcDoc={html}
      sandbox="allow-scripts allow-forms"
      className="w-full h-full border-0 bg-white"
    />
  );
}
