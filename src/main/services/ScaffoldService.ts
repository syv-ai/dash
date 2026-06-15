/**
 * Given the directory listing before and after a generator ran, return the
 * single newly-created entry name, or null when there is no unambiguous new
 * folder (zero new, or more than one new — caller falls back to a folder picker).
 */
export function detectCreatedFolder(before: string[], after: string[]): string | null {
  const beforeSet = new Set(before);
  const added = after.filter((entry) => !beforeSet.has(entry));
  return added.length === 1 ? added[0]! : null;
}
