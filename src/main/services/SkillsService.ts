import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  statSync,
  rmSync,
  renameSync,
  readdirSync,
  type Dirent,
} from 'fs';
import path from 'path';
import os from 'os';
import type {
  RegistrySkill,
  SkillsSearchArgs,
  SkillsSearchResult,
  SkillInstallStatus,
  SkillRef,
  SkillInstallArgs,
  SkillUninstallArgs,
  SkillInstallTarget,
  SkillsRegistryMeta,
  InstalledSkill,
} from '@shared/types';
import { SkillsCache } from './skillsCache';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/majiayu000/claude-skill-registry/main/registry.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// The registry's long tail is dominated by abandoned/duplicate entries; top-N-by-stars
// keeps the on-disk cache compact while covering any skill users are realistically after.
const MAX_SKILLS = 10_000;
const REGISTRY_FETCH_TIMEOUT_MS = 60_000;
const FILE_FETCH_TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_SKILL = 50;
const MAX_RECURSION_DEPTH = 3;
const RAW_GITHUB_PREFIX = 'https://raw.githubusercontent.com/';

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[\w./-]+$/;
const ENTRY_NAME_RE = /^[\w.][\w.-]*$/;

function assertSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(name)}`);
  }
}

// Path segments may contain dots (e.g. ".claude") and dashes; we reject anything that
// could break the URL we'll build (`?`, `#`, whitespace) or escape the directory.
const PATH_SEGMENT_RE = /^[\w.][\w.-]*$/;

function assertRef(ref: SkillRef): void {
  if (!REPO_RE.test(ref.repo)) {
    throw new Error(`Invalid repo: ${JSON.stringify(ref.repo)}`);
  }
  if (!BRANCH_RE.test(ref.branch)) {
    throw new Error(`Invalid branch: ${JSON.stringify(ref.branch)}`);
  }
  const segments = ref.path.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '..' || seg.includes('\0') || !PATH_SEGMENT_RE.test(seg)) {
      throw new Error(`Invalid skill path: ${JSON.stringify(ref.path)}`);
    }
  }
}

function resolveSkillsBaseDir(target: SkillInstallTarget): string {
  switch (target.kind) {
    case 'global':
      return path.join(os.homedir(), '.claude', 'skills');
    case 'project':
      return path.join(target.projectPath, '.claude', 'skills');
    case 'task':
      return path.join(target.worktreePath, '.claude', 'skills');
    default: {
      // Forces a compile error if a future SkillInstallTarget variant is added without
      // updating this switch — we'd rather break the build than silently default to global.
      const _exhaustive: never = target;
      throw new Error(`Unhandled install target: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveInstallDir(target: SkillInstallTarget, skillName: string): string {
  assertSkillName(skillName);
  const base = resolveSkillsBaseDir(target);
  const installDir = path.resolve(base, skillName);
  const rel = path.relative(base, installDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Resolved install dir escapes base: ${installDir}`);
  }
  return installDir;
}

function resolveChildPath(baseDir: string, name: string): string {
  if (!ENTRY_NAME_RE.test(name)) {
    throw new Error(`Invalid file/directory name from registry: ${JSON.stringify(name)}`);
  }
  const child = path.resolve(baseDir, name);
  const rel = path.relative(baseDir, child);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new Error(`Resolved entry escapes parent: ${child}`);
  }
  return child;
}

/** Specialized error so callers can branch on the HTTP status (e.g. 403 = rate limit,
 *  404 = path moved). The message is human-readable; the `status` is for matching. */
class FetchHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(`Fetch ${url} failed: ${status} ${statusText}`);
    this.name = 'FetchHttpError';
  }
}

async function fetchJson(url: string, signal: AbortSignal, headers?: Record<string, string>) {
  const resp = await fetch(url, { signal, headers });
  if (!resp.ok) {
    throw new FetchHttpError(url, resp.status, resp.statusText);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Fetch ${url} returned non-JSON body (status ${resp.status}): ${detail}`);
  }
}

interface RawSkill {
  name?: string;
  description?: string;
  repo?: string;
  path?: string;
  branch?: string;
  category?: string;
  tags?: unknown;
  stars?: number;
  distribution?: string;
}

// A handful of registry entries ship malformed values (e.g. description as ["需要填写描述"]),
// which would otherwise blow up SQLite bindings. Coerce defensively at the boundary.
function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' ');
  return '';
}

function normalizeSkill(s: RawSkill): RegistrySkill | null {
  const name = asString(s.name);
  const repo = asString(s.repo);
  const skillPath = asString(s.path);
  if (!name || !repo || !skillPath) return null;
  const distribution: RegistrySkill['distribution'] =
    s.distribution === 'compatible' || s.distribution === 'restricted' ? s.distribution : undefined;
  return {
    name,
    description: asString(s.description),
    repo,
    path: skillPath,
    branch: asString(s.branch) || 'main',
    category: asString(s.category),
    tags: Array.isArray(s.tags) ? (s.tags.filter((t) => typeof t === 'string') as string[]) : [],
    stars: typeof s.stars === 'number' && Number.isFinite(s.stars) ? s.stars : 0,
    distribution,
  };
}

/**
 * Downloads the registry, normalizes each skill, and replaces the SQLite cache atomically.
 * We previously tried stream-json for low-memory parsing, but the pipeline silently yielded
 * 0 rows in our setup (likely a Buffer/Uint8Array mismatch between Readable.fromWeb and
 * fixUtf8Stream). Buffered parse is reliable and trades ~200 MB transient memory for that.
 */
async function downloadAndStoreRegistry(): Promise<{ inserted: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(REGISTRY_URL, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Registry fetch failed: ${resp.status} ${resp.statusText}`);
    }

    const text = await resp.text();
    let parsed: { skills?: unknown };
    try {
      parsed = JSON.parse(text) as { skills?: unknown };
    } catch (err) {
      throw new Error(`Registry returned non-JSON body (${text.length} bytes): ${String(err)}`);
    }

    // Registry is delivered sorted by stars descending, so a head-slice is "top N by stars".
    const rawSkills = Array.isArray(parsed.skills)
      ? (parsed.skills as RawSkill[]).slice(0, MAX_SKILLS)
      : [];
    const normalized: RegistrySkill[] = [];
    let skipped = 0;
    for (const raw of rawSkills) {
      const n = normalizeSkill(raw);
      if (n) normalized.push(n);
      else skipped += 1;
    }

    // Warn loudly if a meaningful chunk failed normalization — likely a registry schema
    // change rather than the usual 1-2 malformed entries. Below 5% is normal noise.
    if (rawSkills.length > 0 && skipped / rawSkills.length > 0.05) {
      console.warn('[SkillsService.downloadAndStoreRegistry] high skip rate', {
        skipped,
        total: rawSkills.length,
        ratio: (skipped / rawSkills.length).toFixed(3),
      });
    }

    if (normalized.length === 0) {
      throw new Error(
        `Registry parsed but yielded 0 valid skills (raw: ${rawSkills.length}, body: ${text.length} bytes)`,
      );
    }

    // Atomic replace: previous cache survives if this throws mid-transaction.
    return SkillsCache.replaceAll(normalized);
  } finally {
    clearTimeout(timeout);
  }
}

export class SkillsService {
  static getMeta(): SkillsRegistryMeta {
    return SkillsCache.getMeta();
  }

  static getCategories(): string[] {
    return SkillsCache.getCategories();
  }

  /**
   * If the cache is missing or older than CACHE_TTL_MS, refresh it from the registry.
   * forceRefresh bypasses the TTL. Returns the post-refresh meta. When a refresh attempt
   * fails but we have a non-empty cache, returns that cache with `stale: true` and a
   * human-readable `refreshError` so the UI can show the user why fresh data isn't here.
   */
  static async ensureRegistry(forceRefresh = false): Promise<SkillsRegistryMeta> {
    const meta = SkillsCache.getMeta();
    const fresh =
      meta.fetchedAt !== null && meta.totalCount > 0 && Date.now() - meta.fetchedAt < CACHE_TTL_MS;
    if (fresh && !forceRefresh) return meta;

    try {
      await downloadAndStoreRegistry();
    } catch (err) {
      // Stale-cache fallback: a slow/broken registry shouldn't break the UI if we have
      // anything cached, but we MUST signal this to the renderer so the user knows their
      // results are old. Silently returning stale data caused users to sit on weeks-old
      // caches without realising refresh had been broken.
      if (meta.totalCount > 0) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SkillsService.ensureRegistry] using stale cache after fetch failure', {
          message,
        });
        return { ...meta, stale: true, refreshError: message };
      }
      throw err;
    }
    return SkillsCache.getMeta();
  }

  static search(args: SkillsSearchArgs): SkillsSearchResult {
    const result = SkillsCache.search({
      query: args.query ?? '',
      category: args.category,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    });
    return result;
  }

  static async getSkillContent(ref: SkillRef): Promise<string> {
    assertRef(ref);

    const normalizedPath = ref.path.endsWith('SKILL.md')
      ? ref.path
      : ref.path.endsWith('/')
        ? `${ref.path}SKILL.md`
        : `${ref.path}/SKILL.md`;

    const url = `${RAW_GITHUB_PREFIX}${ref.repo}/${ref.branch}/${normalizedPath}`;
    return fetchTextWithLimit(url, FILE_FETCH_TIMEOUT_MS);
  }

  /** Reads SKILL.md for a skill installed locally — used when the catalog has no entry
   *  (custom/long-tail skills) and we therefore can't pull from raw.githubusercontent.com.
   *  installLocation must be either the special string 'global' (resolved to ~/.claude/skills)
   *  or an absolute path that the renderer already validated as a known project/worktree path. */
  static readLocalSkillMd(args: { skillName: string; installLocation: string }): string {
    assertSkillName(args.skillName);
    const baseDir =
      args.installLocation === 'global'
        ? path.join(os.homedir(), '.claude', 'skills')
        : path.join(args.installLocation, '.claude', 'skills');
    // Defense in depth: same escape check we use on writes.
    const skillDir = path.resolve(baseDir, args.skillName);
    const rel = path.relative(baseDir, skillDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Resolved skill dir escapes base: ${skillDir}`);
    }
    const file = path.join(skillDir, 'SKILL.md');
    const stat = statSync(file); // throws ENOENT cleanly if missing
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`SKILL.md exceeds max size (${stat.size} bytes)`);
    }
    return readFileSync(file, 'utf-8');
  }

  static async installSkill(args: SkillInstallArgs): Promise<void> {
    const { ref, skillName, target } = args;
    assertRef(ref);
    const installDir = resolveInstallDir(target, skillName);

    // Stage into a sibling temp dir so a mid-install failure (rate limit, network drop,
    // file-count cap, etc.) can't leave a half-populated skill that checkInstalled would
    // still report as "installed" because SKILL.md happens to exist.
    const stagingDir = `${installDir}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(stagingDir, { recursive: true });

    try {
      const content = await this.getSkillContent(ref);
      writeFileSync(path.join(stagingDir, 'SKILL.md'), content, 'utf-8');

      const counter = { count: 1 };
      await this.fetchSkillDirectory(ref, stagingDir, MAX_RECURSION_DEPTH, counter);

      // Atomic-ish swap: remove any pre-existing install, then rename. rename within the
      // same directory is atomic on POSIX; the prior rmSync is the small race window.
      rmSync(installDir, { recursive: true, force: true });
      renameSync(stagingDir, installDir);
    } catch (err) {
      // Best-effort cleanup of the partial staging tree; never mask the original failure.
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('[SkillsService.installSkill] staging cleanup failed', {
          stagingDir,
          message: String(cleanupErr),
        });
      }
      throw err;
    }
  }

  private static async fetchSkillDirectory(
    ref: SkillRef,
    installDir: string,
    depthRemaining: number,
    counter: { count: number },
  ): Promise<void> {
    if (depthRemaining < 0) {
      // We hit MAX_RECURSION_DEPTH. Skill installs as "successful" but anything deeper
      // is missing; log so a real bug (registry shipping deep trees we should support)
      // doesn't masquerade as a clean install.
      console.warn('[SkillsService.fetchSkillDirectory] depth limit reached; truncating', {
        repo: ref.repo,
        path: ref.path,
      });
      return;
    }

    const dirPath = ref.path.endsWith('SKILL.md')
      ? ref.path.replace(/\/?SKILL\.md$/, '')
      : ref.path;

    if (!dirPath) return;

    const apiUrl = `https://api.github.com/repos/${ref.repo}/contents/${dirPath}?ref=${ref.branch}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FILE_FETCH_TIMEOUT_MS);

    let parsed: unknown;
    try {
      parsed = await fetchJson(apiUrl, controller.signal, {
        Accept: 'application/vnd.github.v3+json',
      });
    } catch (err) {
      // Distinguish 404 (skill moved/renamed upstream — actionable: refresh registry) from
      // generic failures (5xx, network) so the friendly-error mapping in the renderer can
      // produce a useful message.
      if (err instanceof FetchHttpError && err.status === 404) {
        throw new Error(
          `Skill source not found at ${ref.repo}/${dirPath} — the upstream may have moved. Refresh the registry and try again.`,
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to list skill directory ${ref.repo}/${dirPath}: ${detail}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!Array.isArray(parsed)) return;

    const entries = parsed as Array<{
      name: string;
      type: string;
      download_url: string | null;
      size?: number;
    }>;

    // entry.name and entry.download_url come from GitHub's API response — treat as
    // untrusted. resolveChildPath validates the name against ENTRY_NAME_RE and ensures
    // the resolved path stays inside installDir; the download URL is checked against
    // the raw.githubusercontent.com whitelist. Never feed entry.path into recursion or
    // FS writes — rebuild paths from sanitized child names instead.
    for (const entry of entries) {
      if (counter.count >= MAX_FILES_PER_SKILL) {
        throw new Error(`Skill exceeds max files (${MAX_FILES_PER_SKILL})`);
      }
      if (entry.name === 'SKILL.md') continue;

      if (entry.type === 'file' && entry.download_url) {
        if (!entry.download_url.startsWith(RAW_GITHUB_PREFIX)) {
          throw new Error(`Refusing non-GitHub download URL: ${entry.download_url}`);
        }
        if (typeof entry.size === 'number' && entry.size > MAX_FILE_BYTES) {
          throw new Error(`File ${entry.name} exceeds max size (${entry.size} bytes)`);
        }
        const dest = resolveChildPath(installDir, entry.name);
        const body = await fetchTextWithLimit(entry.download_url, FILE_FETCH_TIMEOUT_MS);
        writeFileSync(dest, body, 'utf-8');
        counter.count += 1;
      } else if (entry.type === 'dir') {
        const subDir = resolveChildPath(installDir, entry.name);
        mkdirSync(subDir, { recursive: true });
        const childRef: SkillRef = {
          repo: ref.repo,
          branch: ref.branch,
          path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
        };
        await this.fetchSkillDirectory(childRef, subDir, depthRemaining - 1, counter);
      }
    }
  }

  static checkInstalled(skillName: string, probePaths: string[]): SkillInstallStatus {
    assertSkillName(skillName);
    const home = os.homedir();
    const probeErrors: string[] = [];

    const globalProbe = skillFilePresence(
      path.join(home, '.claude', 'skills', skillName, 'SKILL.md'),
    );
    if (globalProbe.error) probeErrors.push(`global (${globalProbe.error})`);

    const installedPaths: string[] = [];
    for (const pp of probePaths) {
      const probe = skillFilePresence(path.join(pp, '.claude', 'skills', skillName, 'SKILL.md'));
      if (probe.error) probeErrors.push(`${pp} (${probe.error})`);
      if (probe.present) installedPaths.push(pp);
    }

    const status: SkillInstallStatus = { global: globalProbe.present, installedPaths };
    if (probeErrors.length > 0) {
      status.probeError = `Could not check install status for ${probeErrors.join(', ')}`;
    }
    return status;
  }

  /** Lists every skill installed on disk across global + the supplied probePaths.
   *  Joins each found folder name back to the registry cache when possible so the UI
   *  can render full cards; skills installed but not in the cached top-N come back
   *  with `catalog: null`. */
  static listInstalled(probePaths: string[]): InstalledSkill[] {
    const home = os.homedir();
    type Entry = { installedPaths: string[]; globalInstalled: boolean };
    const found = new Map<string, Entry>();

    function record(skillName: string, scope: 'global' | string): void {
      // Defensive: a folder name that wouldn't pass our install validator is suspicious
      // (manually placed file? old install from a different tool?). Skip it rather than
      // surface garbage in the UI.
      if (!SKILL_NAME_RE.test(skillName)) return;
      const entry = found.get(skillName) ?? { installedPaths: [], globalInstalled: false };
      if (scope === 'global') entry.globalInstalled = true;
      else entry.installedPaths.push(scope);
      found.set(skillName, entry);
    }

    for (const name of listSkillFolders(path.join(home, '.claude', 'skills'))) {
      record(name, 'global');
    }
    for (const pp of probePaths) {
      for (const name of listSkillFolders(path.join(pp, '.claude', 'skills'))) {
        record(name, pp);
      }
    }

    // Build a lookup from sanitized install-name → catalog row so we can attach
    // metadata to each installed entry. One pass over the cache keeps this O(N) in the
    // catalog size; per-name SQL would be cheaper but the sanitization rules are awkward
    // to express in SQL. First wins on collisions.
    const catalogByInstallName = new Map<string, RegistrySkill>();
    for (const s of SkillsCache.allSkills()) {
      const installName = deriveInstallNameFromCatalog(s);
      if (installName && !catalogByInstallName.has(installName)) {
        catalogByInstallName.set(installName, s);
      }
    }

    const result: InstalledSkill[] = [];
    for (const [skillName, info] of found) {
      result.push({
        skillName,
        globalInstalled: info.globalInstalled,
        installedPaths: info.installedPaths,
        catalog: catalogByInstallName.get(skillName) ?? null,
      });
    }
    result.sort((a, b) => a.skillName.localeCompare(b.skillName));
    return result;
  }

  static uninstallSkill(args: SkillUninstallArgs): void {
    const { skillName, target } = args;
    const skillDir = resolveInstallDir(target, skillName);

    try {
      const stat = statSync(skillDir);
      if (!stat.isDirectory()) {
        throw new Error(`Refusing to remove non-directory: ${skillDir}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    rmSync(skillDir, { recursive: true, force: true });
  }
}

/** Lists subdirectories of a `.claude/skills/` directory that contain a SKILL.md file.
 *  Returns [] if the directory doesn't exist; logs other errors and returns []. */
function listSkillFolders(skillsDir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true }) as Dirent[];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    console.error('[SkillsService.listSkillFolders] readdir failed', { skillsDir, code });
    return [];
  }
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    if (e.name.includes('.tmp-')) continue; // skip in-flight staging dirs
    if (skillFilePresence(path.join(skillsDir, e.name, 'SKILL.md')).present) {
      names.push(e.name);
    }
  }
  return names;
}

/** Mirrors the renderer's `deriveInstallSkillName` so we can map a catalog row back
 *  to the folder name `installSkill` would use for it. Keep these in sync. */
function deriveInstallNameFromCatalog(skill: RegistrySkill): string {
  const candidates = [skill.name, lastPathSegment(skill.path)];
  for (const c of candidates) {
    if (!c) continue;
    const sanitized = c
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (sanitized && sanitized !== 'unknown' && /^[a-z0-9]/.test(sanitized)) return sanitized;
  }
  return '';
}

function lastPathSegment(p: string): string {
  const segs = p.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  if (last.toLowerCase() === 'skill.md') return segs[segs.length - 2] ?? '';
  return last;
}

/** Probes whether a SKILL.md exists. Distinguishes "not present" from "couldn't read"
 *  so the caller can warn the user when ENOENT is masked by EACCES/EIO etc. */
function skillFilePresence(filePath: string): { present: boolean; error?: string } {
  try {
    statSync(filePath);
    return { present: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { present: false };
    console.error('[SkillsService.checkInstalled] stat failed', { filePath, code });
    return { present: false, error: code || 'unknown error' };
  }
}

async function fetchTextWithLimit(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Fetch ${url} failed: ${resp.status} ${resp.statusText}`);
    }
    const lenHeader = resp.headers.get('content-length');
    if (lenHeader) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > MAX_FILE_BYTES) {
        throw new Error(`File at ${url} exceeds max size (${len} bytes)`);
      }
    }
    const text = await resp.text();
    if (text.length > MAX_FILE_BYTES) {
      throw new Error(`File at ${url} exceeds max size after read (${text.length} bytes)`);
    }
    return text;
  } catch (err) {
    // Bare AbortError ("This operation was aborted") tells you nothing about which file
    // or how long it waited. Repackage with context so logs are diagnosable.
    if (timedOut) {
      throw new Error(`Timeout after ${timeoutMs}ms fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
