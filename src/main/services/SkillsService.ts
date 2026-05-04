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
import { createHash } from 'crypto';
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
import { deriveSkillFolderName } from '@shared/skills';
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
  version: 1;
  repo: string;
  branch: string;
  path: string;
  installedAt: number;
}

// Discriminated union so callers can distinguish "no marker" (legitimate custom-skill
// folder) from "marker present but unreadable" (truncated, schema-mismatched, or hit by
// AV). The earlier null-on-any-failure shape collapsed those modes, leading to:
// checkInstalled saying "not installed" while installSkill refused with "already exists
// but was not installed by Dash" — two contradictory truths from the same FS state.
type MarkerReadResult =
  | { kind: 'absent' }
  | { kind: 'present'; marker: SkillMarker }
  | { kind: 'corrupt'; reason: string };

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

function readSkillMarker(skillDir: string): MarkerReadResult {
  const file = path.join(skillDir, MARKER_FILENAME);
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    console.error('[SkillsService.readSkillMarker] read failed', { file, code });
    return { kind: 'corrupt', reason: code || 'read-failed' };
  }
  let parsed: Partial<SkillMarker>;
  try {
    parsed = JSON.parse(text) as Partial<SkillMarker>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SkillsService.readSkillMarker] parse failed', { file, message });
    return { kind: 'corrupt', reason: 'parse-error' };
  }
  if (
    parsed.version !== MARKER_VERSION ||
    typeof parsed.repo !== 'string' ||
    typeof parsed.path !== 'string' ||
    typeof parsed.branch !== 'string'
  ) {
    console.error('[SkillsService.readSkillMarker] schema mismatch', {
      file,
      version: parsed.version,
    });
    return { kind: 'corrupt', reason: 'schema-mismatch' };
  }
  return { kind: 'present', marker: parsed as SkillMarker };
}

// Negative-cache sentinel: when content-match against the unique registry candidate
// fails for an orphan folder, we record the local SKILL.md hash at check time. Future
// listInstalled calls skip the fetch as long as the local content hasn't changed.
// Editing the skill invalidates the sentinel naturally (different hash); a new install
// via Dash replaces the whole skill directory in the staging swap, so any stale sentinel
// goes with it.
const VERIFIED_CUSTOM_FILENAME = '.dash-skill-checked.json';
const VERIFIED_CUSTOM_VERSION = 1;

interface VerifiedCustomRecord {
  version: 1;
  checkedAt: number;
  /** SHA-256 of the local SKILL.md at the time we checked. The cache is invalid once
   *  the user edits the file, so we re-check and (potentially) bind to a registry
   *  entry that now matches. */
  contentSha256: string;
}

// Same three-state shape as MarkerReadResult so backfill can tell the difference between
// "never checked" (absent) and "stale sentinel" (corrupt) — the latter must trigger a
// re-fetch, not be treated as if the user has never opted in.
type VerifiedCustomReadResult =
  | { kind: 'absent' }
  | { kind: 'present'; record: VerifiedCustomRecord }
  | { kind: 'corrupt'; reason: string };

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function writeVerifiedCustom(skillDir: string, contentSha256: string): void {
  const record: VerifiedCustomRecord = {
    version: VERIFIED_CUSTOM_VERSION,
    checkedAt: Date.now(),
    contentSha256,
  };
  writeFileSync(path.join(skillDir, VERIFIED_CUSTOM_FILENAME), JSON.stringify(record), 'utf-8');
}

function readVerifiedCustom(skillDir: string): VerifiedCustomReadResult {
  const file = path.join(skillDir, VERIFIED_CUSTOM_FILENAME);
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    console.error('[SkillsService.readVerifiedCustom] read failed', { file, code });
    return { kind: 'corrupt', reason: code || 'read-failed' };
  }
  let parsed: Partial<VerifiedCustomRecord>;
  try {
    parsed = JSON.parse(text) as Partial<VerifiedCustomRecord>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SkillsService.readVerifiedCustom] parse failed', { file, message });
    return { kind: 'corrupt', reason: 'parse-error' };
  }
  if (
    parsed.version !== VERIFIED_CUSTOM_VERSION ||
    typeof parsed.contentSha256 !== 'string' ||
    typeof parsed.checkedAt !== 'number'
  ) {
    console.error('[SkillsService.readVerifiedCustom] schema mismatch', {
      file,
      version: parsed.version,
    });
    return { kind: 'corrupt', reason: 'schema-mismatch' };
  }
  return { kind: 'present', record: parsed as VerifiedCustomRecord };
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
      if (stat.isDirectory()) {
        const markerResult = readSkillMarker(installDir);
        if (markerResult.kind === 'absent') {
          throw new Error(
            `${installDir} already exists but was not installed by Dash. Refusing to overwrite — rename or remove the existing folder first if you want to install this skill here.`,
          );
        }
        if (markerResult.kind === 'corrupt') {
          // Corrupt-but-Dash-managed: don't silently overwrite, but give an error a user
          // can act on (uninstall via Dash, then install). Without this branch the user
          // hit "already exists but was not installed by Dash" and had to rm -rf manually.
          throw new Error(
            `Install marker for ${skillName} at ${installDir} is corrupt (${markerResult.reason}). Click Uninstall to remove the folder, then Install again.`,
          );
        }
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

          // Write the marker last. The fetch loop skips entries named SKILL.md, but
          // .dash-skill.json isn't on that allow-list — a registry that ships its own
          // file by that name would otherwise leave a stale marker on disk after the
          // recursive copy. Writing here guarantees we own the final bytes.
          writeSkillMarker(stagingDir, ref);

          // Atomic-ish swap: remove any pre-existing install, then rename the whole
          // staging directory in. rename within the same parent is atomic on POSIX; the
          // in-flight lock above guards against concurrent installs racing
          // rmSync+renameSync. The precondition above guarantees we only rmSync a
          // Dash-installed dir.
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
      if (probe.error) probeFailures.push({ scope: 'path', path: pp, code: probe.error });
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
      if (probe.error) probeFailures.push({ scope: 'path', path: pp, code: probe.error });
    }

    // Recognise externally-installed registry skills (skills.sh, Claude Code native
    // skills, manual installs) by content match. Runs before the catalog join so any
    // freshly-written markers are picked up below. The persistent verified-custom
    // sentinel means each truly-custom folder pays the fetch cost at most once.
    await backfillExternalInstalls(found, home);

    // Catalog join is keyed by (repo, path) read from each install's marker file.
    // Folders without a marker — user's own custom skills, ambiguous name matches —
    // fall through with catalog: null and render as Custom.
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
        const result = readSkillMarker(dir);
        if (result.kind === 'present') {
          return catalogByRepoPath.get(`${result.marker.repo}|${result.marker.path}`) ?? null;
        }
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

// Recognises skill folders installed outside Dash (via skills.sh, Claude Code's native
// skills system, manual clone, etc.) that match a registry entry byte-for-byte. For
// each marker-less folder with a unique name-matching candidate, fetches the registry
// SKILL.md and compares; on match writes the marker so the catalog metadata renders.
// On no match, writes a sentinel keyed by the local content hash so the same folder
// isn't refetched until the user edits the file.
async function backfillExternalInstalls(
  found: Map<string, InstalledEntry>,
  home: string,
): Promise<void> {
  const candidatesByName = new Map<string, RegistrySkill[]>();
  for (const s of SkillsCache.allSkills()) {
    const name = deriveSkillFolderName(s);
    if (!name) continue;
    const arr = candidatesByName.get(name) ?? [];
    arr.push(s);
    candidatesByName.set(name, arr);
  }

  // Per-skill try/catch so one failure (EACCES on a single mount, network glitch, JSON
  // parse error in a sentinel) doesn't reject the whole Promise.all and blank the
  // installed list. Backfill is best-effort — a failure here just means the affected
  // folder shows up as "Custom" until the next listInstalled call retries it.
  await Promise.all(
    Array.from(found.entries()).map(async ([skillName, info]) => {
      try {
        await tryBackfillOne(skillName, info, candidatesByName, home);
      } catch (err) {
        console.warn('[SkillsService.backfill] skill-level failure', {
          skillName,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

async function tryBackfillOne(
  skillName: string,
  info: InstalledEntry,
  candidatesByName: Map<string, RegistrySkill[]>,
  home: string,
): Promise<void> {
  const candidates = candidatesByName.get(skillName) ?? [];
  // Ambiguous name (multiple candidates) or no candidate at all → leave as Custom
  // and don't write a sentinel: there's nothing to learn from a fetch we wouldn't
  // do, and a future registry refresh might disambiguate.
  if (candidates.length !== 1) return;
  const ref = candidates[0];

  const dirs: string[] = [];
  if (info.globalInstalled) dirs.push(path.join(home, '.claude', 'skills', skillName));
  for (const pp of info.installedPaths) {
    dirs.push(path.join(pp, '.claude', 'skills', skillName));
  }

  // Filter to dirs that are still orphan candidates: no marker (so not already bound),
  // and either no sentinel or a stale sentinel (the user has edited the SKILL.md or
  // the previous record is unreadable, so we should re-check). A `corrupt` marker is
  // *not* treated as orphan — the install precondition errors will guide the user to
  // uninstall+reinstall instead.
  const orphans = dirs.filter((d) => {
    const marker = readSkillMarker(d);
    if (marker.kind === 'present' || marker.kind === 'corrupt') return false;
    const sentinel = readVerifiedCustom(d);
    if (sentinel.kind === 'absent' || sentinel.kind === 'corrupt') return true;
    let local: string;
    try {
      local = readFileSync(path.join(d, 'SKILL.md'), 'utf-8');
    } catch {
      return false;
    }
    // Re-check if user edited the file since the sentinel was written.
    return sha256(local) !== sentinel.record.contentSha256;
  });
  if (orphans.length === 0) return;

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
    let localContent: string;
    try {
      localContent = readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    } catch (err) {
      console.warn('[SkillsService.backfill] could not read local SKILL.md', {
        dir,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      if (localContent === registryContent) {
        writeSkillMarker(dir, ref);
      } else {
        writeVerifiedCustom(dir, sha256(localContent));
      }
    } catch (err) {
      console.warn('[SkillsService.backfill] could not write marker/sentinel', {
        dir,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// "Is this skill dir an install of `expectedRef`?" — when expectedRef is null, falls
// back to "does SKILL.md exist". When expectedRef is supplied, requires the Dash marker
// to be present AND match (repo, path). A corrupt marker is surfaced as an error so the
// UI can show "marker-corrupt" in probe failures rather than reporting the same FS
// state as both "not installed" (here) and "already exists but not Dash" (install path).
function scopeMatchesRef(
  skillDir: string,
  expectedRef: SkillRef | null,
): { present: boolean; error?: string } {
  const presence = skillFilePresence(path.join(skillDir, 'SKILL.md'));
  if (!presence.present) return presence;
  if (!expectedRef) return presence;
  const result = readSkillMarker(skillDir);
  if (result.kind === 'absent') return { present: false };
  if (result.kind === 'corrupt') return { present: false, error: 'marker-corrupt' };
  if (result.marker.repo !== expectedRef.repo || result.marker.path !== expectedRef.path) {
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
