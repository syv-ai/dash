import { app } from 'electron';
import path from 'path';
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs';

/**
 * Single-file registry for Dash's skill bookkeeping, stored in Dash's own
 * app-data dir (next to app.db) instead of as `.dash-skill.json` /
 * `.dash-skill-checked.json` files inside each `.claude/skills/<name>/` folder.
 * Keeping it here means Dash never writes into the user's actual codebase.
 *
 * Keyed by the absolute skill directory. Each entry holds at most:
 *   - `source` — this folder is a Dash install of a registry skill (the old
 *     `.dash-skill.json` marker): repo/branch/path + when.
 *   - `custom` — negative cache for a content-mismatched folder (the old
 *     `.dash-skill-checked.json` sentinel): the SKILL.md hash we last checked,
 *     so listInstalled doesn't re-fetch the registry copy every time.
 * The two are mutually exclusive per dir — binding a source clears any custom.
 */

const REGISTRY_FILENAME = 'skills-registry.json';
const REGISTRY_VERSION = 1;

export interface SkillSourceRecord {
  repo: string;
  branch: string;
  path: string;
  installedAt: number;
}

export interface SkillCustomRecord {
  contentSha256: string;
  checkedAt: number;
}

export interface SkillsRegistryEntry {
  source?: SkillSourceRecord;
  custom?: SkillCustomRecord;
}

interface RegistryFile {
  version: number;
  entries: Record<string, SkillsRegistryEntry>;
}

// In-memory cache of the parsed file. Written through on every mutation; the
// file is small (one entry per installed/checked skill) so we rewrite it whole.
let cache: RegistryFile | null = null;

function filePath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILENAME);
}

function load(): RegistryFile {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf-8')) as Partial<RegistryFile>;
    if (parsed && typeof parsed.entries === 'object' && parsed.entries) {
      cache = { version: REGISTRY_VERSION, entries: parsed.entries as RegistryFile['entries'] };
      return cache;
    }
    console.error('[SkillsRegistry] schema mismatch — starting empty');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the normal first-run case; anything else (parse error, EACCES)
    // is non-destructive to recover from — backfill re-derives source bindings
    // by content match, so an empty start self-heals on the next listInstalled.
    if (code !== 'ENOENT') {
      console.error('[SkillsRegistry] read/parse failed — starting empty', {
        message: String(err),
      });
    }
  }
  cache = { version: REGISTRY_VERSION, entries: {} };
  return cache;
}

function persist(): void {
  const data = load();
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    // Write-then-rename so a crash mid-write can't truncate the live registry.
    const tmp = `${filePath()}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    renameSync(tmp, filePath());
  } catch (err) {
    console.error('[SkillsRegistry] persist failed', { message: String(err) });
  }
}

export function getRegistryEntry(skillDir: string): SkillsRegistryEntry | undefined {
  return load().entries[skillDir];
}

export function setSkillSource(skillDir: string, source: SkillSourceRecord): void {
  const data = load();
  // A source binding supersedes the custom negative-cache for the same dir.
  data.entries[skillDir] = { source };
  persist();
}

export function setSkillCustom(skillDir: string, custom: SkillCustomRecord): void {
  const data = load();
  const entry = data.entries[skillDir] ?? {};
  entry.custom = custom;
  data.entries[skillDir] = entry;
  persist();
}

export function removeRegistryEntry(skillDir: string): void {
  const data = load();
  if (data.entries[skillDir]) {
    delete data.entries[skillDir];
    persist();
  }
}

/** Test-only: drop the in-memory cache and the on-disk file so each test starts clean. */
export function __resetSkillsRegistryForTest(): void {
  cache = null;
  try {
    rmSync(filePath(), { force: true });
  } catch {
    /* ignore */
  }
}
