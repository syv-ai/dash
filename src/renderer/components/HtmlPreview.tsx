import React from 'react';

interface HtmlPreviewProps {
  html: string;
}

/**
 * Render an HTML string in a sandboxed iframe via `srcDoc`. The sandbox grants
 * scripts/forms/popups but deliberately omits `allow-same-origin`, so the
 * preview cannot reach the app's origin, storage, or `window.electronAPI`.
 * Relative asset references won't resolve (no base URL) — self-contained pages
 * with inline or absolute/CDN resources render as expected.
 */
export function HtmlPreview({ html }: HtmlPreviewProps) {
  return (
    <iframe
      title="HTML preview"
      srcDoc={html}
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
      className="w-full h-full border-0 bg-white"
    />
  );
}
