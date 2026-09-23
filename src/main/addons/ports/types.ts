// Types for the ports add-on. They stay inside the add-on: the renderer only
// sees the drawer blocks built from them.

/** Where a host port came from. Shown in the row tooltip. */
export type PortSource = 'fixed' | 'hash' | 'override' | 'probe';

export interface TaskPort {
  id: string;
  taskId: string;
  label: string;
  /** null for Tier 1 (fixed) entries — they have no env var. */
  envVar: string | null;
  /** null for Tier 1 entries; the schema-declared port the assignment was derived from. */
  defaultPort: number | null;
  hostPort: number;
  source: PortSource;
  /** Optional repo-specific service commands from .dash/ports.json. */
  runCommand: string | null;
  stopCommand: string | null;
  logsCommand: string | null;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-port liveness. 'unknown' = first probe pending. */
export type PortLiveness = 'up' | 'down' | 'unknown';

/**
 * Lowercase, collapse non-alphanumerics to single hyphens, trim hyphens, cap
 * at 50. Same shape as Dash's shared slugify, so service keys stay stable.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
