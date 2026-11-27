/*
 * What the app's window may navigate to, and which links leave for the
 * browser (`window.ts`). Pure, so the rules are tested without a window.
 */

/** A URL the browser (or mail app) may open: http(s) and mailto only, never
 *  `file:`, `javascript:` or an app's own scheme, which `shell.openExternal`
 *  would hand to whatever claims it. */
export function isExternalWebUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const withoutHash = (url: string) => url.split('#')[0];

/**
 * Whether a frame may go to `url`. The window stays on the page it loaded
 * (a dropped file or a stray link would replace the app); a reload never
 * asks. A subframe is only ever an editor preview's srcdoc document, whose
 * untrusted content (a link with its own target, a meta refresh) must not
 * take it anywhere: its links leave through the window-open handler instead.
 */
export function mayNavigate(url: string, isMainFrame: boolean, currentUrl: string): boolean {
  if (!isMainFrame) return url === 'about:srcdoc' || url === 'about:blank';
  return currentUrl !== '' && withoutHash(url) === withoutHash(currentUrl);
}
