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
  InstalledSkillsResult,
  ProbeFailure,
} from '@shared/types';
import { SkillsCache } from './skillsCache';

// Trust boundary: this third-party GitHub repo is effectively Dash's package registry.
// Pinning to a specific repo+branch+filename is a deliberate choice; changing this
// constant changes who can ship code to every Dash user.
const REGISTRY_URL =
  'https://raw.githubusercontent.com/majiayu000/claude-skill-registry/main/registry.json';

// 24h matches the registry's typical update cadence (daily refresh of GitHub stars).
// Shorter would just hammer raw.githubusercontent.com without surfacing newer data;
// longer would let users sit on stale popularity rankings.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// The registry's long tail is dominated by abandoned/duplicate entries. 10K covers
// every skill with non-trivial star counts at current registry sizes (~150K total),
// keeps the SQLite file under ~30 MB, and bounds the buffered JSON parse memory.
const MAX_SKILLS = 10_000;

// 60s is generous for a ~10 MB JSON payload over a slow connection. Short enough that
// a hung server fails the open-lifecycle within the user's patience window.
const REGISTRY_FETCH_TIMEOUT_MS = 60_000;

// Per-file timeout for SKILL.md and sibling assets. 15s covers slow connections
// without making a stuck connection block the install for minutes.
const FILE_FETCH_TIMEOUT_MS = 15_000;

// Wall-clock cap on a single install. Without this, a pathological skill (50 files,
// each hanging until FILE_FETCH_TIMEOUT_MS) keeps the user staring at a spinner for
// >12 min. In-flight fetches still drain on their own timers; this only fails the
// user-facing op.
const INSTALL_TIMEOUT_MS = 120_000;

// SKILL.md files in the registry are <100 KB in practice; 2 MB allows for the rare
// long-form skill while bounding the worst-case download per file. Also caps the
// readFileSync we do on local installs.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Largest legitimate skill in the registry has ~10 files. 50 is a defensive cap
// against a malicious registry entry pointing at a bloated directory; combined with
// MAX_FILE_BYTES it bounds total install download to ~100 MB.
const MAX_FILES_PER_SKILL = 50;

// Skills are flat or one level deep in observed registry data; 3 is permissive but
// still rejects pathological recursive trees.
const MAX_RECURSION_DEPTH = 3;

// Pinned host for content downloads. Anything outside this prefix is refused even if
// the GitHub contents API points us there — defense in depth against a compromised
// registry that supplies attacker-hosted download_url values.
const RAW_GITHUB_PREFIX = 'https://raw.githubusercontent.com/';

// Dash-owned marker dropped into every install dir so we can distinguish skills
// installed via Dash (and from which registry entry) from a user's pre-existing folder
// of the same name. Without this, a registry skill named "validate" silently overwrites
// a user's custom ~/.claude/skills/validate, and the installed-list view conflates the
// two by sanitized-name fuzzy match.
const MARKER_FILENAME = '.dash-skill.json';
const MARKER_VERSION = 1;

interface SkillMarker {
  version: number;
  repo: string;
  branch: string;
  path: string;
  installedAt: number;
}

function writeSkillMarker(skillDir: string, ref: SkillRef): void {
  const marker: SkillMarker = {
    version: MARKER_VERSION,
    repo: ref.repo,
    branch: ref.branch,
    path: ref.path,
    installedAt: Date.now(),
  };
  writeFileSync(path.join(skillDir, MARKER_FILENAME), JSON.stringify(marker), 'utf-8');
}

function readSkillMarker(skillDir: string): SkillMarker | null {
  try {
    const text = readFileSync(path.join(skillDir, MARKER_FILENAME), 'utf-8');
    const parsed = JSON.parse(text) as Partial<SkillMarker>;
    if (
      parsed.version !== MARKER_VERSION ||
      typeof parsed.repo !== 'string' ||
      typeof parsed.path !== 'string' ||
      typeof parsed.branch !== 'string'
    ) {
      return null;
    }
    return parsed as SkillMarker;
  } catch {
    return null;
  }
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[\w./-]+$/;
const ENTRY_NAME_RE = /^[\w.][\w.-]*$/;

export function assertSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(name)}`);
  }
}

// Path segments may contain dots (e.g. ".claude") and dashes; we reject anything that
// could break the URL we'll build (`?`, `#`, whitespace) or escape the directory.
const PATH_SEGMENT_RE = /^[\w.][\w.-]*$/;

export function assertRef(ref: SkillRef): void {
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
      const _exhaustive: never = target;
      throw new Error(`Unhandled install target: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function resolveInstallDir(target: SkillInstallTarget, skillName: string): string {
  assertSkillName(skillName);
  const base = resolveSkillsBaseDir(target);
  const installDir = path.resolve(base, skillName);
  const rel = path.relative(base, installDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Resolved install dir escapes base: ${installDir}`);
  }
  return installDir;
}

export function resolveChildPath(baseDir: string, name: string): string {
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
function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.trunc(v), min), max);
}

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

// Buffered parse rather than stream-json: a Buffer/Uint8Array mismatch between
// Readable.fromWeb and fixUtf8Stream silently yielded 0 rows in our setup. Cost is
// ~200 MB transient memory during the JSON.parse.
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

// Per-installDir lock: two clicks on "Install" (e.g. dropdown re-open) would otherwise
// race the rmSync+renameSync swap and either stomp each other or fail with ENOTEMPTY.
const installsInFlight = new Set<string>();

export class SkillsService {
  static getMeta(): SkillsRegistryMeta {
    return SkillsCache.getMeta();
  }

  static getCategories(): string[] {
    return SkillsCache.getCategories();
  }

  static async ensureRegistry(forceRefresh = false): Promise<SkillsRegistryMeta> {
    const meta = SkillsCache.getMeta();
    const isFresh = meta.status === 'fresh' && Date.now() - meta.fetchedAt < CACHE_TTL_MS;
    if (isFresh && !forceRefresh) return meta;

    try {
      await downloadAndStoreRegistry();
    } catch (err) {
      // Stale-cache fallback: a slow/broken registry shouldn't break the UI if we have
      // anything cached, but we MUST signal this to the renderer so the user knows their
      // results are old. Silently returning stale data caused users to sit on weeks-old
      // caches without realising refresh had been broken.
      if (meta.status !== 'never-fetched') {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SkillsService.ensureRegistry] using stale cache after fetch failure', {
          message,
        });
        return {
          status: 'stale',
          totalCount: meta.totalCount,
          fetchedAt: meta.fetchedAt,
          refreshError: message,
        };
      }
      throw err;
    }
    return SkillsCache.getMeta();
  }

  static search(args: SkillsSearchArgs): SkillsSearchResult {
    // Clamp to defend against negative or wildly-large values from a misbehaving caller —
    // SQLite happily accepts a negative LIMIT but the result is a confused empty page,
    // not a clear error.
    const limit = clampInt(args.limit, 50, 1, 200);
    const offset = clampInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    return SkillsCache.search({
      query: args.query ?? '',
      category: args.category,
      limit,
      offset,
    });
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
   *  Takes the same SkillInstallTarget union as install/uninstall so the base dir is
   *  resolved through the same closed switch. */
  static readLocalSkillMd(args: { skillName: string; target: SkillInstallTarget }): string {
    const skillDir = resolveInstallDir(args.target, args.skillName);
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

    if (installsInFlight.has(installDir)) {
      throw new Error(
        `An install for ${skillName} at this location is already in progress. Wait for it to finish.`,
      );
    }

    // Refuse to overwrite a directory that wasn't installed by Dash. Without this guard,
    // installing a registry skill whose name collides with a user's existing folder
    // (e.g. a custom "validate" skill) would silently rmSync their data on the swap.
    // ENOENT and any other unexpected stat error are deferred to the swap itself.
    try {
      const stat = statSync(installDir);
      if (stat.isDirectory() && !readSkillMarker(installDir)) {
        throw new Error(
          `${installDir} already exists but was not installed by Dash. Refusing to overwrite — rename or remove the existing folder first if you want to install this skill here.`,
        );
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Allow ENOENT (the install dir simply doesn't exist yet); rethrow our own
      // refusal error and any unexpected errno (EACCES on the parent etc).
      if (code !== 'ENOENT') throw err;
    }

    installsInFlight.add(installDir);

    // Stage into a sibling temp dir so a mid-install failure (rate limit, network drop,
    // file-count cap, etc.) can't leave a half-populated skill that checkInstalled would
    // still report as "installed" because SKILL.md happens to exist.
    const stagingDir = `${installDir}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(stagingDir, { recursive: true });

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`)),
        INSTALL_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([
        (async () => {
          const content = await this.getSkillContent(ref);
          writeFileSync(path.join(stagingDir, 'SKILL.md'), content, 'utf-8');

          const counter = { count: 1 };
          await this.fetchSkillDirectory(ref, stagingDir, MAX_RECURSION_DEPTH, counter);

          // Write the marker last so it overwrites any registry-supplied .dash-skill.json
          // (we own this filename). The marker carries the registry coordinates so the
          // installed-list view and checkInstalled can match by (repo, path) instead of
          // sanitized folder name.
          writeSkillMarker(stagingDir, ref);

          // Atomic-ish swap: remove any pre-existing install, then rename. rename within
          // the same directory is atomic on POSIX; the in-flight lock above guards
          // against concurrent installs racing rmSync+renameSync. The precondition
          // above guarantees we only rmSync a Dash-installed dir.
          rmSync(installDir, { recursive: true, force: true });
          renameSync(stagingDir, installDir);
        })(),
        timeoutPromise,
      ]);
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
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      installsInFlight.delete(installDir);
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

    if (!Array.isArray(parsed)) {
      // GitHub returns an object (not an array) when the path resolves to a single file
      // or to an error envelope (e.g. `{ message: "Not Found" }`). The previous behavior
      // silently skipped this — install would report success after copying SKILL.md only.
      // Fail loudly so users see the upstream weirdness instead of an incomplete install.
      throw new Error(
        `GitHub contents API returned non-array shape for ${ref.repo}/${dirPath}; the upstream may have moved or rate-limited.`,
      );
    }

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

  static checkInstalled(
    skillName: string,
    probePaths: string[],
    ref: SkillRef | null = null,
  ): SkillInstallStatus {
    assertSkillName(skillName);
    if (ref) assertRef(ref);
    const home = os.homedir();
    const probeFailures: ProbeFailure[] = [];

    const globalDir = path.join(home, '.claude', 'skills', skillName);
    const globalProbe = scopeMatchesRef(globalDir, ref);
    if (globalProbe.error) probeFailures.push({ scope: 'global', code: globalProbe.error });

    const installedPaths: string[] = [];
    for (const pp of probePaths) {
      const probe = scopeMatchesRef(path.join(pp, '.claude', 'skills', skillName), ref);
      if (probe.error) probeFailures.push({ scope: pp, code: probe.error });
      if (probe.present) installedPaths.push(pp);
    }

    const status: SkillInstallStatus = { global: globalProbe.present, installedPaths };
    if (probeFailures.length > 0) status.probeFailures = probeFailures;
    return status;
  }

  static async listInstalled(probePaths: string[]): Promise<InstalledSkillsResult> {
    const home = os.homedir();
    const found = new Map<string, InstalledEntry>();
    const probeFailures: ProbeFailure[] = [];

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

    const globalProbe = listSkillFolders(path.join(home, '.claude', 'skills'));
    for (const name of globalProbe.names) record(name, 'global');
    if (globalProbe.error) probeFailures.push({ scope: 'global', code: globalProbe.error });

    for (const pp of probePaths) {
      const probe = listSkillFolders(path.join(pp, '.claude', 'skills'));
      for (const name of probe.names) record(name, pp);
      if (probe.error) probeFailures.push({ scope: pp, code: probe.error });
    }

    // Backfill markers on legacy installs (from before the marker contract existed).
    // Runs before the catalog join so freshly-written markers are picked up below.
    await backfillOrphanMarkers(found, home);

    // Catalog join is keyed by (repo, path) read from each install's marker file.
    // The previous sanitized-folder-name fuzzy match conflated unrelated skills that
    // happened to share a name (e.g. user's custom "validate" → registry "validate").
    // Folders without a marker fall through with catalog: null and render as Custom.
    const catalogByRepoPath = new Map<string, RegistrySkill>();
    for (const s of SkillsCache.allSkills()) {
      catalogByRepoPath.set(`${s.repo}|${s.path}`, s);
    }

    function lookupCatalog(skillName: string, info: InstalledEntry): RegistrySkill | null {
      const candidates: string[] = [];
      if (info.globalInstalled) {
        candidates.push(path.join(home, '.claude', 'skills', skillName));
      }
      for (const pp of info.installedPaths) {
        candidates.push(path.join(pp, '.claude', 'skills', skillName));
      }
      for (const dir of candidates) {
        const marker = readSkillMarker(dir);
        if (marker) return catalogByRepoPath.get(`${marker.repo}|${marker.path}`) ?? null;
      }
      return null;
    }

    const skills: InstalledSkill[] = [];
    for (const [skillName, info] of found) {
      skills.push({
        skillName,
        globalInstalled: info.globalInstalled,
        installedPaths: info.installedPaths,
        catalog: lookupCatalog(skillName, info),
      });
    }
    skills.sort((a, b) => a.skillName.localeCompare(b.skillName));
    return { skills, probeFailures };
  }

  /** Wipes the on-disk cache and refetches the registry. Last-resort recovery for when
   *  the SQLite cache has corrupted in a way that the auto-retry on read methods can't
   *  fix on its own. */
  static async resetCache(): Promise<SkillsRegistryMeta> {
    SkillsCache.resetCache();
    await downloadAndStoreRegistry();
    return SkillsCache.getMeta();
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

// Returns the SKILL.md-bearing folders under a `.claude/skills/` dir. ENOENT collapses
// to "empty"; any other errno (EACCES, EIO, …) is reported via `error` so the caller
// can surface the truncation to the user instead of silently returning [].
function listSkillFolders(skillsDir: string): { names: string[]; error?: string } {
  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true }) as Dirent[];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { names: [] };
    console.error('[SkillsService.listSkillFolders] readdir failed', { skillsDir, code });
    return { names: [], error: code || 'unknown' };
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
  return { names };
}

interface InstalledEntry {
  installedPaths: string[];
  globalInstalled: boolean;
}

// Mirrors the renderer's `deriveInstallSkillName` so we can map a catalog row back to
// the folder name `installSkill` would use for it. Used now only by the legacy backfill
// to find candidate registry matches for marker-less install dirs — keep these in sync.
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

// In-memory memo of (dir, repo|path) pairs we've already attempted to verify. A skill
// folder whose SKILL.md doesn't match the registry candidate is likely truly custom;
// retrying the fetch every time the user opens the modal is wasteful. Cleared on app
// restart, which is cheap because the work is bounded by orphan-folder count.
const backfillTried = new Set<string>();

// Best-effort migration for installs from before the marker contract existed (PR
// 0.9.13 and earlier). For each marker-less folder, look up the unique registry skill
// whose sanitized install-name matches the folder name; fetch its SKILL.md; if local
// content is byte-equal, write the marker. On ambiguity (multiple candidates) or any
// difference, the folder stays Custom — we don't guess. Skips already-marked dirs.
async function backfillOrphanMarkers(
  found: Map<string, InstalledEntry>,
  home: string,
): Promise<void> {
  const candidatesByName = new Map<string, RegistrySkill[]>();
  for (const s of SkillsCache.allSkills()) {
    const name = deriveInstallNameFromCatalog(s);
    if (!name) continue;
    const arr = candidatesByName.get(name) ?? [];
    arr.push(s);
    candidatesByName.set(name, arr);
  }

  await Promise.all(
    Array.from(found.entries()).map(async ([skillName, info]) => {
      const candidates = candidatesByName.get(skillName) ?? [];
      if (candidates.length !== 1) return; // Ambiguous or no candidate → leave as Custom.
      const ref = candidates[0];
      const refKey = `${ref.repo}|${ref.path}`;

      const dirs: string[] = [];
      if (info.globalInstalled) dirs.push(path.join(home, '.claude', 'skills', skillName));
      for (const pp of info.installedPaths) {
        dirs.push(path.join(pp, '.claude', 'skills', skillName));
      }

      const orphans = dirs.filter((d) => {
        if (backfillTried.has(`${d}|${refKey}`)) return false;
        return readSkillMarker(d) === null;
      });
      if (orphans.length === 0) return;

      orphans.forEach((d) => backfillTried.add(`${d}|${refKey}`));

      let registryContent: string;
      try {
        registryContent = await SkillsService.getSkillContent(ref);
      } catch (err) {
        console.warn('[SkillsService.backfill] could not fetch registry SKILL.md', {
          repo: ref.repo,
          path: ref.path,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      for (const dir of orphans) {
        try {
          const localContent = readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
          if (localContent === registryContent) {
            writeSkillMarker(dir, ref);
          }
        } catch (err) {
          console.warn('[SkillsService.backfill] could not read local SKILL.md', {
            dir,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }),
  );
}

// "Is this skill dir an install of `expectedRef`?" — when expectedRef is null, falls
// back to "does SKILL.md exist". When expectedRef is supplied, requires the Dash marker
// to be present AND match (repo, path), so a user's custom folder of the same name
// doesn't get reported as the registry skill being installed.
function scopeMatchesRef(
  skillDir: string,
  expectedRef: SkillRef | null,
): { present: boolean; error?: string } {
  const presence = skillFilePresence(path.join(skillDir, 'SKILL.md'));
  if (!presence.present) return presence;
  if (!expectedRef) return presence;
  const marker = readSkillMarker(skillDir);
  if (!marker) return { present: false };
  if (marker.repo !== expectedRef.repo || marker.path !== expectedRef.path) {
    return { present: false };
  }
  return { present: true };
}

// Distinguishes "not present" from "couldn't read" so callers can warn the user when
// ENOENT is masked by EACCES/EIO etc.
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
