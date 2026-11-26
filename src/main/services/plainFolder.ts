import { promises as fs } from 'fs';
import * as path from 'path';
import type { RepoListing } from '@shared/types';

/** How many entries a plain folder's listing walks before it stops descending. */
export const PLAIN_LISTING_CAP = 5000;

/**
 * A folder that isn't a repository (a memory folder, a session's scratchpad)
 * as the file tree lists it: every file under it, relative and `/`-joined,
 * and in `dirs` the folders the tree can't infer from a file (empty ones,
 * symlinked ones, and any left unwalked past `cap` entries), which it lists
 * when opened. Breadth first, so a cap cuts the deepest folders.
 */
export async function listPlainFolder(
  root: string,
  cap: number = PLAIN_LISTING_CAP,
): Promise<RepoListing> {
  const files: string[] = [];
  const dirs: string[] = [];
  let seen = 0;
  const queue: string[] = [''];
  for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
    if (seen >= cap) {
      dirs.push(rel);
      continue;
    }
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    if (entries.length === 0 && rel) dirs.push(rel);
    for (const e of entries) {
      if (e.name === '.git') continue;
      seen++;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) queue.push(child);
      else if (e.isSymbolicLink() && (await isDirectory(path.join(root, child)))) dirs.push(child);
      else if (e.isFile() || e.isSymbolicLink()) files.push(child);
    }
  }
  return { files: files.sort(), dirs: dirs.sort() };
}

async function isDirectory(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}
