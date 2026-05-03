import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import type { RegistrySkill, SkillsRegistryMeta } from '@shared/types';

const CACHE_FILENAME = 'skills-cache.db';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CACHE_FILENAME);
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  ensureSchema(db);
  return db;
}

function ensureSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      branch TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL,
      stars INTEGER NOT NULL,
      distribution TEXT,
      path_segment TEXT NOT NULL,
      PRIMARY KEY (repo, path)
    );

    CREATE INDEX IF NOT EXISTS skills_category_idx ON skills(category);
    CREATE INDEX IF NOT EXISTS skills_distribution_idx ON skills(distribution);
    CREATE INDEX IF NOT EXISTS skills_stars_idx ON skills(stars DESC);

    -- External-content FTS5: the index points at rowids in the skills table rather than
    -- duplicating the text columns. Halves the on-disk size, but means writes to the
    -- skills table do NOT auto-populate FTS — replaceAll must explicitly issue an
    -- INSERT INTO skills_fts(skills_fts) VALUES("rebuild") after batch inserts.
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      name,
      description,
      tags,
      repo,
      path_segment,
      content='skills',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export interface SearchArgs {
  query: string;
  category?: string;
  limit: number;
  offset: number;
}

export interface SearchResult {
  skills: RegistrySkill[];
  total: number;
}

interface SkillRow {
  repo: string;
  path: string;
  name: string;
  description: string;
  branch: string;
  category: string;
  tags: string;
  stars: number;
  distribution: string | null;
  path_segment: string;
}

function rowToSkill(r: SkillRow): RegistrySkill {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(r.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch (err) {
    // The only writer (replaceAll below) always emits valid JSON, so this catch firing
    // means schema corruption or a writer regression — log it loudly so we'd notice in
    // Sentry, but degrade gracefully (tags are search-only, never load-bearing).
    console.error('[SkillsCache.rowToSkill] invalid tags JSON', {
      key: `${r.repo}|${r.path}`,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const distribution: RegistrySkill['distribution'] =
    r.distribution === 'compatible' || r.distribution === 'restricted' ? r.distribution : undefined;
  return {
    name: r.name,
    description: r.description,
    repo: r.repo,
    path: r.path,
    branch: r.branch,
    category: r.category,
    tags,
    stars: r.stars,
    distribution,
  };
}

// Last meaningful path segment: ".claude/skills/foo/SKILL.md" → "foo".
// Used as a search-indexed fallback name for entries the registry labels "unknown".
export function pathSegment(p: string): string {
  const segments = p.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (last.toLowerCase() === 'skill.md') return segments[segments.length - 2] ?? '';
  return last;
}

// FTS5 MATCH treats certain characters as syntax. Quote each token so user input like
// "pdf-extract" or "C++" doesn't blow up the parser; combine with implicit AND.
function buildFtsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\w-]/g, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export const SkillsCache = {
  getMeta(): SkillsRegistryMeta {
    const d = getDb();
    const row = d.prepare(`SELECT value FROM meta WHERE key = 'fetchedAt'`).get() as
      | { value: string }
      | undefined;
    const fetchedAt = row ? Number(row.value) : null;
    const total = d.prepare(`SELECT COUNT(*) as n FROM skills`).get() as { n: number };
    return { fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null, totalCount: total.n };
  },

  getCategories(): string[] {
    const d = getDb();
    const rows = d
      .prepare(
        `SELECT DISTINCT category FROM skills WHERE category != '' ORDER BY category COLLATE NOCASE`,
      )
      .all() as Array<{ category: string }>;
    return rows.map((r) => r.category);
  },

  /** Returns every cached skill row. Used by listInstalled to map filesystem folder names
   *  back to catalog entries — at 10K rows the load is ~5 ms and beats a per-name SQL
   *  fuzzy match given the sanitization rules. */
  allSkills(): RegistrySkill[] {
    const d = getDb();
    const rows = d.prepare(`SELECT * FROM skills`).all() as SkillRow[];
    return rows.map(rowToSkill);
  },

  search(args: SearchArgs): SearchResult {
    const d = getDb();
    const ftsQuery = buildFtsQuery(args.query);
    const filters: string[] = [];
    const params: Record<string, unknown> = {
      limit: args.limit,
      offset: args.offset,
    };
    if (args.category) {
      filters.push('s.category = @category');
      params.category = args.category;
    }

    // Pin anthropics/skills entries first, then by FTS rank (when searching) or stars.
    const officialOrder = `CASE WHEN s.repo = 'anthropics/skills' THEN 0 ELSE 1 END`;

    let whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    let fromSql = `FROM skills s`;
    let orderSql = `ORDER BY ${officialOrder}, s.stars DESC`;

    if (ftsQuery) {
      fromSql = `FROM skills_fts JOIN skills s ON s.rowid = skills_fts.rowid`;
      const matchClause = `skills_fts MATCH @match`;
      whereSql =
        filters.length > 0
          ? `WHERE ${matchClause} AND ${filters.join(' AND ')}`
          : `WHERE ${matchClause}`;
      params.match = ftsQuery;
      orderSql = `ORDER BY ${officialOrder}, bm25(skills_fts), s.stars DESC`;
    }

    const totalRow = d.prepare(`SELECT COUNT(*) as n ${fromSql} ${whereSql}`).get(params) as {
      n: number;
    };
    const rows = d
      .prepare(`SELECT s.* ${fromSql} ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`)
      .all(params) as SkillRow[];

    return { skills: rows.map(rowToSkill), total: totalRow.n };
  },

  /**
   * Atomic replace: drop all existing rows, insert the new batch in one transaction,
   * rebuild the FTS index, stamp meta. If the caller throws mid-stream, the transaction
   * rolls back and the previous cache is preserved.
   */
  replaceAll(skills: readonly RegistrySkill[]): { inserted: number } {
    const d = getDb();
    const insert = d.prepare(`
      INSERT OR REPLACE INTO skills
        (repo, path, name, description, branch, category, tags, stars, distribution, path_segment)
      VALUES
        (@repo, @path, @name, @description, @branch, @category, @tags, @stars, @distribution, @path_segment)
    `);

    const txn = d.transaction((batch: readonly RegistrySkill[]) => {
      d.exec(`DELETE FROM skills_fts; DELETE FROM skills;`);
      let count = 0;
      for (const s of batch) {
        if (!s.name || !s.repo || !s.path) continue;
        insert.run({
          repo: s.repo,
          path: s.path,
          name: s.name,
          description: s.description ?? '',
          branch: s.branch || 'main',
          category: s.category ?? '',
          tags: JSON.stringify(Array.isArray(s.tags) ? s.tags : []),
          stars: s.stars ?? 0,
          distribution:
            s.distribution === 'compatible' || s.distribution === 'restricted'
              ? s.distribution
              : null,
          path_segment: pathSegment(s.path),
        });
        count += 1;
      }
      d.exec(`INSERT INTO skills_fts(skills_fts) VALUES('rebuild');`);
      return count;
    });

    const inserted = txn(skills);
    // Only stamp fetchedAt on a successful, non-empty refresh. If the upstream payload
    // ever yields 0 valid rows, leaving fetchedAt unchanged means the next modal open
    // re-runs the refresh instead of treating an empty cache as "fresh".
    if (inserted > 0) this.setMeta({ fetchedAt: Date.now() });
    return { inserted };
  },

  setMeta(values: Record<string, string | number>): void {
    const d = getDb();
    const stmt = d.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)`);
    const txn = d.transaction((entries: Array<[string, string]>) => {
      for (const [k, v] of entries) stmt.run({ key: k, value: v });
    });
    txn(Object.entries(values).map(([k, v]) => [k, String(v)]));
  },

  // For tests / dev: returns the underlying DB. Not exported through the service.
  _db(): Database.Database {
    return getDb();
  },
};
