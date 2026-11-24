/** `path` with the home folder shown as `~` (as a shell prints it). */
export function tildePath(path: string, home: string): string {
  const h = home.replace(/\/+$/, '');
  if (!h) return path;
  if (path === h) return '~';
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

/**
 * A path split for middle truncation: the head may be cut short (an ellipsis
 * at its end), the tail, its last segment, always shows. `/a/b/c` →
 * [`/a/b/`, `c`].
 */
export function splitForMiddleTruncation(path: string): [head: string, tail: string] {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut <= 0) return ['', trimmed || path];
  return [trimmed.slice(0, cut + 1), trimmed.slice(cut + 1)];
}
