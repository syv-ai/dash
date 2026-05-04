import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Blocks,
  Search,
  Star,
  Download,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  Loader2,
  AlertCircle,
  Check,
  FolderOpen,
  GitBranch,
  Trash2,
} from 'lucide-react';
import type {
  RegistrySkill,
  SkillInstallStatus,
  SkillInstallTarget,
  SkillsRegistryMeta,
  InstalledSkill,
  ProbeFailure,
} from '../../shared/types';
import { deriveSkillFolderName } from '../../shared/skills';
import { Tooltip } from './ui/Tooltip';

const ICON_SIZE = 14;
const ICON_STROKE = 1.8;
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 200;
// 24 hours; matches main-process TTL. We use this only to decide whether to auto-refresh on open.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

interface ActiveTaskInfo {
  taskId: string;
  taskName: string;
  worktreePath: string;
  projectId: string;
  projectName: string;
}

interface SkillsBrowserModalProps {
  projects: ProjectInfo[];
  activeProjectId?: string;
  /** Every worktree-backed, non-archived task across all projects. Shown in the install
   *  dropdown so users can scope a skill to any specific task, not just the current one. */
  activeTasks: ActiveTaskInfo[];
  /** ID of the task currently focused in the main UI; used to highlight it in the list. */
  currentTaskId?: string;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  development: 'Development',
  testing: 'Testing',
  data: 'Data',
  design: 'Design',
  documents: 'Documents',
  productivity: 'Productivity',
  devops: 'DevOps',
  security: 'Security',
  marketing: 'Marketing',
  product: 'Product',
  communication: 'Communication',
  creative: 'Creative',
};

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

// Uppercase K to match GitHub's UI; lowercase k is reserved for the star count below.
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

// Map known failure modes to actionable user-facing messages. Raw errors still go to the logs.
function friendlyError(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes('aborterror') || lower.includes('aborted'))
    return 'Request timed out. Try again.';
  if (lower.includes('rate limit') || lower.includes('403')) {
    return 'GitHub rate limit hit. Try again later.';
  }
  if (lower.includes('eacces') || lower.includes('permission denied')) {
    return 'Permission denied writing to the install directory.';
  }
  if (lower.includes('enospc')) return 'Not enough disk space.';
  if (
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return 'Network error reaching GitHub.';
  }
  // Whitelist specific user-actionable validation messages instead of returning every
  // 'invalid' error verbatim — the latter leaks internal paths/JSON snippets.
  if (lower.includes('invalid skill name') || lower.includes('invalid repo')) return raw;
  return fallback;
}

function probeFailureKey(f: ProbeFailure): string {
  return f.scope === 'global' ? `global|${f.code}` : `${f.path}|${f.code}`;
}

function probeFailureLabel(f: ProbeFailure): string {
  return f.scope === 'global' ? '~/.claude/skills' : f.path;
}

function pathSegmentName(skillPath: string): string {
  const segments = skillPath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (last.toLowerCase() === 'skill.md') return segments[segments.length - 2] ?? '';
  return last;
}

function displaySkillName(skill: RegistrySkill): string {
  const raw = (skill.name ?? '').trim();
  if (raw && raw.toLowerCase() !== 'unknown') return raw;
  const fromPath = pathSegmentName(skill.path);
  return fromPath || raw || '(unnamed skill)';
}

function skillKey(skill: RegistrySkill): string {
  return `${skill.repo}|${skill.path}`;
}

function skillGithubUrl(skill: RegistrySkill): string {
  // The slim cache doesn't persist a deep link, so synthesize one from repo+branch+path
  // when path looks like a real file/folder. Falls back to the repo root.
  const cleanPath = skill.path.replace(/\/+$/, '');
  if (cleanPath) {
    return `https://github.com/${skill.repo}/blob/${skill.branch}/${cleanPath}`;
  }
  return `https://github.com/${skill.repo}`;
}

// Literal Tailwind classes so the JIT scanner picks them up at build time. Each slot
// references one of the --cat-1..8 tokens defined in index.css (light + dark variants).
const CATEGORY_PALETTE = [
  'bg-[hsl(var(--cat-1)/0.16)] text-[hsl(var(--cat-1))]',
  'bg-[hsl(var(--cat-2)/0.16)] text-[hsl(var(--cat-2))]',
  'bg-[hsl(var(--cat-3)/0.16)] text-[hsl(var(--cat-3))]',
  'bg-[hsl(var(--cat-4)/0.16)] text-[hsl(var(--cat-4))]',
  'bg-[hsl(var(--cat-5)/0.16)] text-[hsl(var(--cat-5))]',
  'bg-[hsl(var(--cat-6)/0.16)] text-[hsl(var(--cat-6))]',
  'bg-[hsl(var(--cat-7)/0.16)] text-[hsl(var(--cat-7))]',
  'bg-[hsl(var(--cat-8)/0.16)] text-[hsl(var(--cat-8))]',
] as const;

// djb2 hash → slot. Same category always lands on the same slot, so the badge color
// is consistent everywhere the same category appears (cards, detail header, future filters).
function categorySlot(category: string): number {
  let h = 5381;
  for (let i = 0; i < category.length; i++) {
    h = ((h << 5) + h) ^ category.charCodeAt(i);
  }
  // `>>> 0` coerces to unsigned 32-bit so the modulo is non-negative even on the
  // INT32_MIN boundary where Math.abs(-2147483648) is still negative.
  return (h >>> 0) % CATEGORY_PALETTE.length;
}

function CategoryBadge({ category }: { category: string }) {
  if (!category) return null;
  const colorClasses = CATEGORY_PALETTE[categorySlot(category)];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${colorClasses}`}>
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function RestrictedBadge({ skill }: { skill: RegistrySkill }) {
  if (skill.distribution !== 'restricted') return null;
  return (
    <Tooltip content="Restricted license — verify upstream terms on GitHub before reuse.">
      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-destructive/15 text-destructive leading-none flex-shrink-0">
        Restricted
      </span>
    </Tooltip>
  );
}

interface LocationChipsProps {
  entry: InstalledSkill;
  projects: ProjectInfo[];
  activeTasks: ActiveTaskInfo[];
}

// Cap on chips before collapsing the tail into a "+N others" badge. Three is enough to
// convey common scopes (global + project + task) without crowding out the skill name.
const LOCATION_CHIP_LIMIT = 3;

function LocationChips({ entry, projects, activeTasks }: LocationChipsProps) {
  type Chip = { key: string; kind: 'global' | 'project' | 'task'; label: string };
  const chips: Chip[] = [];
  if (entry.globalInstalled) chips.push({ key: 'global', kind: 'global', label: 'Global' });
  for (const pp of entry.installedPaths) {
    const matchedTask = activeTasks.find((t) => t.worktreePath === pp);
    if (matchedTask) {
      chips.push({ key: pp, kind: 'task', label: matchedTask.taskName });
      continue;
    }
    const matchedProject = projects.find((p) => p.path === pp);
    chips.push({ key: pp, kind: 'project', label: matchedProject?.name ?? pp });
  }
  if (chips.length === 0) return null;

  const visible = chips.slice(0, LOCATION_CHIP_LIMIT);
  const overflow = chips.slice(LOCATION_CHIP_LIMIT);
  const overflowTooltip = overflow.map((c) => c.label).join(', ');

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {visible.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/60 text-muted-foreground leading-none"
        >
          {c.kind === 'task' ? (
            <GitBranch size={10} strokeWidth={ICON_STROKE} />
          ) : c.kind === 'project' ? (
            <FolderOpen size={10} strokeWidth={ICON_STROKE} />
          ) : null}
          <span className="truncate max-w-[140px]">{c.label}</span>
        </span>
      ))}
      {overflow.length > 0 && (
        <Tooltip content={overflowTooltip}>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/60 text-muted-foreground leading-none">
            +{overflow.length} {overflow.length === 1 ? 'other' : 'others'}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export function SkillsBrowserModal({
  projects,
  activeProjectId,
  activeTasks,
  currentTaskId,
  onClose,
}: SkillsBrowserModalProps) {
  const [closing, setClosing] = useState(false);
  const [meta, setMeta] = useState<SkillsRegistryMeta | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [results, setResults] = useState<RegistrySkill[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  // Split per surface so a successful search doesn't clear an installed-list error
  // (and vice versa). searchError covers the "all" view's runSearch/refresh/reset/open
  // lifecycle; installedError covers loadInstalled and the installed-view click handler.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');
  const [view, setView] = useState<'all' | 'installed'>('all');
  const [installedList, setInstalledList] = useState<InstalledSkill[]>([]);
  const [installedProbeFailures, setInstalledProbeFailures] = useState<ProbeFailure[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<RegistrySkill | null>(null);
  // When non-null, the currently-selected skill is a local-only install (no catalog entry),
  // so SKILL.md must be read from this on-disk location instead of fetched from GitHub.
  // The companion `customInstalled` keeps the original entry around so we can render the
  // "Installed in" panel correctly without re-running checkInstalled.
  const [localReadTarget, setLocalReadTarget] = useState<SkillInstallTarget | null>(null);
  const [customInstalled, setCustomInstalled] = useState<InstalledSkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [skillContentError, setSkillContentError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showInstallDropdown, setShowInstallDropdown] = useState(false);
  const [installStatus, setInstallStatus] = useState<SkillInstallStatus | null>(null);
  // Distinct from probeFailures inside installStatus: this is the "we couldn't even ask"
  // state, signalling the user can't trust the absence of an "Installed in" panel as
  // proof the skill isn't installed.
  const [installStatusError, setInstallStatusError] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Each search bumps a token; results from earlier (slower) searches are discarded if a newer one finished first.
  const searchTokenRef = useRef(0);
  // Same idea, but for the detail panel: rapidly clicking between skills must not let
  // a slower per-skill IPC (skillsCheckInstalled / skillsGetContent) land after a newer
  // selection and overwrite state for the wrong skill — the trash buttons on "Installed in"
  // would then point at the wrong target.
  const selectionTokenRef = useRef(0);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  const runSearch = useCallback(
    async (
      nextQuery: string,
      nextCategory: string,
      offset: number,
      append: boolean,
    ): Promise<void> => {
      const token = ++searchTokenRef.current;
      setSearching(true);
      setSearchError(null);
      try {
        const result = await window.electronAPI.skillsSearch({
          query: nextQuery,
          category: nextCategory || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (token !== searchTokenRef.current) return;
        if (result.success && result.data) {
          setResults((prev) => (append ? [...prev, ...result.data!.skills] : result.data!.skills));
          setResultTotal(result.data.total);
          setPageOffset(offset);
        } else {
          console.error('[SkillsBrowserModal.runSearch] failed', { error: result.error });
          setSearchError(friendlyError(result.error, 'Search failed'));
        }
      } catch (err) {
        if (token !== searchTokenRef.current) return;
        console.error('[SkillsBrowserModal.runSearch] threw', err);
        setSearchError(friendlyError(String(err), 'Search failed'));
      } finally {
        if (token === searchTokenRef.current) setSearching(false);
      }
    },
    [],
  );

  const refreshRegistry = useCallback(
    async (force: boolean): Promise<SkillsRegistryMeta | null> => {
      setRefreshing(true);
      setSearchError(null);
      try {
        const result = await window.electronAPI.skillsRefresh(force ? { force: true } : undefined);
        if (result.success && result.data) {
          setMeta(result.data);
          return result.data;
        }
        console.error('[SkillsBrowserModal.refreshRegistry] failed', { error: result.error });
        setSearchError(friendlyError(result.error, 'Failed to refresh skills registry'));
        return null;
      } catch (err) {
        console.error('[SkillsBrowserModal.refreshRegistry] threw', err);
        setSearchError(friendlyError(String(err), 'Failed to refresh skills registry'));
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  const handleResetCache = useCallback(async () => {
    setRefreshing(true);
    setSearchError(null);
    try {
      const result = await window.electronAPI.skillsResetCache();
      if (result.success && result.data) {
        setMeta(result.data);
        await runSearch(query, category, 0, false);
      } else {
        console.error('[SkillsBrowserModal.handleResetCache] failed', { error: result.error });
        setSearchError(friendlyError(result.error, 'Failed to reset skills cache'));
      }
    } catch (err) {
      console.error('[SkillsBrowserModal.handleResetCache] threw', err);
      setSearchError(friendlyError(String(err), 'Failed to reset skills cache'));
    } finally {
      setRefreshing(false);
    }
  }, [query, category, runSearch]);

  const loadCategories = useCallback(async () => {
    try {
      const result = await window.electronAPI.skillsGetCategories();
      if (result.success && result.data) {
        setCategories(result.data);
        setCategoriesError(null);
      } else {
        console.error('[SkillsBrowserModal.loadCategories] failed', { error: result.error });
        setCategoriesError(friendlyError(result.error, 'Could not load categories'));
      }
    } catch (err) {
      console.error('[SkillsBrowserModal.loadCategories] threw', err);
      setCategoriesError('Could not load categories');
    }
  }, []);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    setInstalledError(null);
    try {
      const probePaths = [
        ...projects.map((p) => p.path),
        ...activeTasks.map((t) => t.worktreePath),
      ];
      const result = await window.electronAPI.skillsListInstalled({ probePaths });
      if (result.success && result.data) {
        setInstalledList(result.data.skills);
        setInstalledProbeFailures(result.data.probeFailures);
      } else {
        // Don't yank the prior list on failure — keep showing what we had and surface
        // the error as a banner so the user keeps their context.
        console.error('[SkillsBrowserModal.loadInstalled] failed', { error: result.error });
        setInstalledError(friendlyError(result.error, 'Failed to list installed skills'));
      }
    } catch (err) {
      console.error('[SkillsBrowserModal.loadInstalled] threw', err);
      setInstalledError(friendlyError(String(err), 'Failed to list installed skills'));
    } finally {
      setLoadingInstalled(false);
    }
  }, [projects, activeTasks]);

  // Re-run the installed scan whenever the user toggles into the Installed view (also
  // after an install or uninstall while in this view, via the dependency on activeTasks/projects).
  useEffect(() => {
    if (view !== 'installed') return;
    loadInstalled();
  }, [view, loadInstalled]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metaResp = await window.electronAPI.skillsGetMeta();
        if (cancelled) return;
        const current = metaResp.success && metaResp.data ? metaResp.data : null;
        const stale =
          !current ||
          current.status === 'never-fetched' ||
          (current.status === 'fresh' && Date.now() - current.fetchedAt > STALE_AFTER_MS);
        const metaToUse = stale ? await refreshRegistry(false) : current;
        if (cancelled) return;
        if (metaToUse) setMeta(metaToUse);
        await loadCategories();
        if (cancelled) return;
        await runSearch('', '', 0, false);
      } catch (err) {
        // The async helpers (refreshRegistry, runSearch) handle their own errors via
        // setError; this catch protects against unexpected throws from the bridge itself
        // (e.g. preload mis-binding) so the modal isn't left wedged in `refreshing` state.
        if (cancelled) return;
        console.error('[SkillsBrowserModal] open-lifecycle threw', err);
        setSearchError(friendlyError(String(err), 'Failed to open Skills Browser'));
        setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRegistry, loadCategories, runSearch]);

  // Debounced search on query/category change. The first effect (above) seeds results,
  // so we skip the very first run here to avoid a duplicate empty search.
  const initialRenderRef = useRef(true);
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query, category, 0, false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, category, runSearch]);

  async function handleManualRefresh() {
    const next = await refreshRegistry(true);
    if (next) {
      await loadCategories();
      runSearch(query, category, 0, false);
    }
  }

  async function loadSkillContent(skill: RegistrySkill) {
    const token = selectionTokenRef.current;
    setLoadingContent(true);
    setSkillContent(null);
    setSkillContentError(null);
    try {
      // Custom (local-only) skills aren't in the registry and have no repo to fetch from —
      // read the SKILL.md off the local filesystem instead. The target is captured up-front
      // so a switch-back to a registry skill mid-await is still tied to the right token.
      const target = localReadTarget;
      const result = target
        ? await window.electronAPI.skillsReadLocalSkillMd({
            skillName: deriveSkillFolderName(skill) || skill.name,
            target,
          })
        : await window.electronAPI.skillsGetContent({
            repo: skill.repo,
            path: skill.path,
            branch: skill.branch,
          });
      if (token !== selectionTokenRef.current) return;
      // Empty SKILL.md is a legitimate (if unusual) result; checking for `result.data`
      // truthily would route the empty-string case into the error branch with no error
      // to display.
      if (result.success && typeof result.data === 'string') {
        setSkillContent(result.data);
      } else {
        console.error('[SkillsBrowserModal.loadSkillContent] failed', { error: result.error });
        setSkillContentError(friendlyError(result.error, 'Failed to load SKILL.md'));
      }
    } catch (err) {
      if (token !== selectionTokenRef.current) return;
      console.error('[SkillsBrowserModal.loadSkillContent] threw', err);
      setSkillContentError(friendlyError(String(err), 'Failed to load SKILL.md'));
    } finally {
      if (token === selectionTokenRef.current) setLoadingContent(false);
    }
  }

  const checkInstallStatus = useCallback(
    async (skill: RegistrySkill) => {
      const token = selectionTokenRef.current;
      const skillName = deriveSkillFolderName(skill);
      if (!skillName) {
        setInstallStatus(null);
        return;
      }
      // Custom stub: no remote ref to verify against, install status is already
      // synthesized by handleSelectCustom. Calling main with an empty ref would trip
      // assertRef and surface a confusing "Invalid repo: \"\"" message to the user.
      if (!skill.repo) return;
      // Include every active worktree task path so the "Installed in" section can show
      // task-scoped installs alongside global/project ones. The backend just probes paths;
      // the renderer figures out which is which when rendering.
      const probePaths = [
        ...projects.map((p) => p.path),
        ...activeTasks.map((t) => t.worktreePath),
      ];
      try {
        const result = await window.electronAPI.skillsCheckInstalled({
          skillName,
          probePaths,
          // Carry the registry coordinates so main verifies the install marker matches
          // — without this, a user's custom `<skillName>` folder gets reported as the
          // registry skill being installed.
          ref: { repo: skill.repo, branch: skill.branch, path: skill.path },
        });
        if (token !== selectionTokenRef.current) return;
        if (result.success && result.data) {
          setInstallStatus(result.data);
          setInstallStatusError(null);
        } else {
          console.error('[SkillsBrowserModal.checkInstallStatus] failed', {
            error: result.error,
          });
          setInstallStatus(null);
          setInstallStatusError(
            friendlyError(result.error, 'Could not check whether this skill is installed'),
          );
        }
      } catch (err) {
        if (token !== selectionTokenRef.current) return;
        console.error('[SkillsBrowserModal.checkInstallStatus] threw', err);
        setInstallStatus(null);
        setInstallStatusError('Could not check whether this skill is installed');
      }
    },
    [projects, activeTasks],
  );

  function handleSelectSkill(skill: RegistrySkill) {
    // Bump the selection token so any in-flight loadSkillContent / checkInstallStatus
    // for the previous skill will discard their results when they eventually resolve.
    selectionTokenRef.current += 1;
    setSelectedSkill(skill);
    setSkillContent(null);
    setSkillContentError(null);
    setInstallSuccess(null);
    setInstallError(null);
    setInstallStatus(null);
    setInstallStatusError(null);
    setLocalReadTarget(null);
    setCustomInstalled(null);
    checkInstallStatus(skill);
  }

  // For installed skills the registry doesn't know about: synthesize a stub RegistrySkill
  // so the detail pane works, route SKILL.md reads to the local filesystem instead of
  // GitHub, and skip the registry-driven install flow (the skill is already on disk).
  function handleSelectCustom(entry: InstalledSkill) {
    selectionTokenRef.current += 1;
    // Pick a deterministic location: prefer global, otherwise the first probe path we
    // know it's installed in, mapped back to the right kind by matching against the
    // projects/activeTasks props. A path that matches neither means the install lives
    // outside any known scope — refuse to read rather than guess.
    const target: SkillInstallTarget | null = entry.globalInstalled
      ? { kind: 'global' }
      : (() => {
          const p = entry.installedPaths[0];
          if (!p) return null;
          if (projects.some((proj) => proj.path === p)) {
            return { kind: 'project', projectPath: p };
          }
          if (activeTasks.some((t) => t.worktreePath === p)) {
            return { kind: 'task', worktreePath: p };
          }
          return null;
        })();
    if (!target) {
      console.error('[SkillsBrowserModal.handleSelectCustom] entry has no resolvable target', {
        skillName: entry.skillName,
      });
      setInstalledError('Skill data is stale. Refresh the installed list and try again.');
      return;
    }
    const stub: RegistrySkill = {
      name: entry.skillName,
      description: '',
      repo: '',
      path: '',
      branch: '',
      category: '',
      tags: [],
      stars: 0,
    };
    setSelectedSkill(stub);
    setSkillContent(null);
    setSkillContentError(null);
    setInstallSuccess(null);
    setInstallError(null);
    setInstallStatus({
      global: entry.globalInstalled,
      installedPaths: entry.installedPaths,
    });
    setInstallStatusError(null);
    setLocalReadTarget(target);
    setCustomInstalled(entry);
    // setState is async; pass the target explicitly so the fetch doesn't see a null
    // localReadTarget on the first render after click.
    void loadSkillContentFromLocal(stub, target);
  }

  async function loadSkillContentFromLocal(skill: RegistrySkill, target: SkillInstallTarget) {
    const token = selectionTokenRef.current;
    setLoadingContent(true);
    setSkillContent(null);
    setSkillContentError(null);
    try {
      const result = await window.electronAPI.skillsReadLocalSkillMd({
        skillName: deriveSkillFolderName(skill) || skill.name,
        target,
      });
      if (token !== selectionTokenRef.current) return;
      // Empty SKILL.md is legal — see loadSkillContent for the same rationale.
      if (result.success && typeof result.data === 'string') {
        setSkillContent(result.data);
      } else {
        console.error('[SkillsBrowserModal.loadSkillContentFromLocal] failed', {
          error: result.error,
        });
        setSkillContentError(friendlyError(result.error, 'Failed to read SKILL.md'));
      }
    } catch (err) {
      if (token !== selectionTokenRef.current) return;
      console.error('[SkillsBrowserModal.loadSkillContentFromLocal] threw', err);
      setSkillContentError(friendlyError(String(err), 'Failed to read SKILL.md'));
    } finally {
      if (token === selectionTokenRef.current) setLoadingContent(false);
    }
  }

  function targetLabel(target: SkillInstallTarget, skillName: string, label?: string): string {
    switch (target.kind) {
      case 'global':
        return `~/.claude/skills/${skillName}/`;
      case 'project':
        return `${label || 'project'}/.claude/skills/${skillName}/`;
      case 'task':
        return `task “${label || 'current task'}” (worktree)`;
    }
  }

  async function handleUninstall(target: SkillInstallTarget, label?: string) {
    if (!selectedSkill) return;
    const skillName = deriveSkillFolderName(selectedSkill);
    if (!skillName) {
      setInstallError('Cannot derive a valid skill name to remove.');
      return;
    }
    setUninstalling(true);
    setInstallSuccess(null);
    setInstallError(null);

    try {
      const result = await window.electronAPI.skillsUninstall({ skillName, target });
      if (result.success) {
        setInstallSuccess(`Removed from ${targetLabel(target, skillName, label)}`);
        if (customInstalled) {
          // Custom skill: re-derive install status locally instead of round-tripping to
          // checkInstalled with the synthetic stub (which has no real repo and would
          // trip assertRef on the main side).
          setInstallStatus((prev) => {
            if (!prev) return null;
            const next: SkillInstallStatus = {
              global: target.kind === 'global' ? false : prev.global,
              installedPaths: prev.installedPaths.filter((p) => {
                if (target.kind === 'project') return p !== target.projectPath;
                if (target.kind === 'task') return p !== target.worktreePath;
                return true;
              }),
            };
            if (prev.probeFailures) next.probeFailures = prev.probeFailures;
            return next;
          });
        } else {
          checkInstallStatus(selectedSkill);
        }
        // Keep the Installed list in sync so the just-removed card disappears immediately.
        if (view === 'installed') loadInstalled();
      } else {
        setInstallError(friendlyError(result.error, 'Removal failed'));
      }
    } catch (err) {
      console.error('[SkillsBrowserModal.handleUninstall] threw', err);
      setInstallError(friendlyError(String(err), 'Removal failed'));
    } finally {
      setUninstalling(false);
    }
  }

  async function handleInstall(target: SkillInstallTarget, label?: string) {
    if (!selectedSkill) return;
    const skillName = deriveSkillFolderName(selectedSkill);
    if (!skillName) {
      setInstallError('Cannot derive a valid skill name to install.');
      return;
    }
    setInstalling(true);
    setInstallSuccess(null);
    setInstallError(null);
    setShowInstallDropdown(false);

    try {
      const result = await window.electronAPI.skillsInstall({
        ref: {
          repo: selectedSkill.repo,
          path: selectedSkill.path,
          branch: selectedSkill.branch,
        },
        skillName,
        target,
      });
      if (result.success) {
        setInstallSuccess(`Installed to ${targetLabel(target, skillName, label)}`);
        checkInstallStatus(selectedSkill);
        // Keep the Installed list in sync so the card just installed appears immediately.
        if (view === 'installed') loadInstalled();
      } else {
        setInstallError(friendlyError(result.error, 'Installation failed'));
      }
    } catch (err) {
      console.error('[SkillsBrowserModal.handleInstall] threw', err);
      setInstallError(friendlyError(String(err), 'Installation failed'));
    } finally {
      setInstalling(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleClose();
  }

  const showLoadMore = view === 'all' && pageOffset + results.length < resultTotal;
  const totalCached = meta?.totalCount ?? 0;
  const isInitialLoad = refreshing && results.length === 0;
  const hasActiveFilter = query.trim().length > 0 || category.length > 0;

  // Client-side filter for the Installed view. Memoized because the IIFE form ran on
  // every render — even unrelated state churn (PTY/git ticks bubbling via context) —
  // and the list is read by both the count chip and the row map.
  const filteredInstalled = useMemo(() => {
    if (view !== 'installed') return [];
    const q = query.trim().toLowerCase();
    return installedList.filter((entry) => {
      if (category && entry.catalog?.category !== category) return false;
      if (!q) return true;
      const haystacks = [
        entry.skillName,
        entry.catalog?.name,
        entry.catalog?.description,
        entry.catalog?.repo,
        ...(entry.catalog?.tags ?? []),
      ];
      return haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(q));
    });
  }, [view, query, category, installedList]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center modal-backdrop ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleBackdropClick}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <div
        className={`bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0 bg-[hsl(var(--surface-2))]">
          <div className="flex items-center gap-3 min-w-0">
            <Blocks
              size={ICON_SIZE}
              strokeWidth={ICON_STROKE}
              className="text-muted-foreground flex-shrink-0"
            />
            <span className="text-[13px] font-medium text-foreground">Skills Browser</span>
            {view === 'installed'
              ? !loadingInstalled && (
                  <span className="text-[11px] text-muted-foreground">
                    {formatCount(filteredInstalled.length)} installed
                    {hasActiveFilter && filteredInstalled.length !== installedList.length && (
                      <span className="ml-1 text-muted-foreground/70">
                        of {formatCount(installedList.length)}
                      </span>
                    )}
                  </span>
                )
              : !isInitialLoad &&
                (totalCached > 0 ? (
                  <Tooltip
                    content={`Searching across the top ${totalCached} skills by GitHub stars. Refresh to update.`}
                  >
                    <span className="text-[11px] text-muted-foreground">
                      {formatCount(resultTotal)} result{resultTotal !== 1 ? 's' : ''}
                      {/* "of N" is only meaningful when filtering reduces results — otherwise it
                          just duplicates the same number in two formats. */}
                      {hasActiveFilter && resultTotal !== totalCached && (
                        <span className="ml-1 text-muted-foreground/70">
                          of {formatCount(totalCached)}
                        </span>
                      )}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {formatCount(resultTotal)} result{resultTotal !== 1 ? 's' : ''}
                  </span>
                ))}
          </div>

          <div className="flex items-center gap-1">
            <Tooltip content="Refresh registry">
              <button
                onClick={handleManualRefresh}
                disabled={refreshing}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-150 disabled:opacity-40"
              >
                <RefreshCw
                  size={ICON_SIZE}
                  strokeWidth={ICON_STROKE}
                  className={refreshing ? 'animate-spin' : ''}
                />
              </button>
            </Tooltip>
            <Tooltip content="Close">
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-150"
              >
                <X size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Stale-cache banner */}
        {meta?.status === 'stale' && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-destructive/10 text-[11px] text-destructive">
            <AlertCircle size={ICON_SIZE} strokeWidth={ICON_STROKE} className="flex-shrink-0" />
            <span className="flex-1">
              Refresh failed; showing cached results from{' '}
              {new Date(meta.fetchedAt).toLocaleString()} (
              {friendlyError(meta.refreshError, 'Network error')}).
            </span>
            <button
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-destructive/15 hover:bg-destructive/25 transition-colors disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background border border-border/60 focus-within:border-primary/40 transition-colors">
            <Search
              size={ICON_SIZE}
              strokeWidth={ICON_STROKE}
              className="text-muted-foreground flex-shrink-0"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills..."
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-border/60 overflow-hidden text-[12px]">
            <button
              onClick={() => setView('all')}
              className={`px-2.5 py-1.5 transition-colors ${
                view === 'all'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setView('installed')}
              className={`px-2.5 py-1.5 transition-colors ${
                view === 'installed'
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Installed
            </button>
          </div>

          {/* Category filter */}
          <div className="relative">
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background border border-border/60 text-[12px] text-foreground hover:border-primary/40 transition-colors min-w-[120px]"
            >
              <span className="truncate">
                {category ? CATEGORY_LABELS[category] || category : 'All categories'}
              </span>
              {categoriesError ? (
                <Tooltip content={categoriesError}>
                  <AlertCircle
                    size={ICON_SIZE}
                    strokeWidth={ICON_STROKE}
                    className="text-destructive flex-shrink-0"
                  />
                </Tooltip>
              ) : (
                <ChevronDown
                  size={ICON_SIZE}
                  strokeWidth={ICON_STROKE}
                  className="text-muted-foreground flex-shrink-0"
                />
              )}
            </button>

            {showCategoryDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowCategoryDropdown(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border/60 rounded-lg shadow-xl py-1 min-w-[160px] max-h-[300px] overflow-y-auto">
                  <button
                    onClick={() => {
                      setCategory('');
                      setShowCategoryDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-accent/60 transition-colors ${!category ? 'text-primary font-medium' : 'text-foreground'}`}
                  >
                    All categories
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setCategory(cat);
                        setShowCategoryDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-accent/60 transition-colors ${category === cat ? 'text-primary font-medium' : 'text-foreground'}`}
                    >
                      {CATEGORY_LABELS[cat] || cat}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Skill list */}
          <div className="w-[55%] border-r border-border/40 overflow-y-auto">
            {view === 'installed' ? (
              <>
                {/* Installed view: error/probe-failure banners ride above the list so a
                    fresh failure doesn't blow away the data the user was looking at. */}
                {installedError && (
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-destructive/10 text-[11px] text-destructive">
                    <AlertCircle
                      size={ICON_SIZE}
                      strokeWidth={ICON_STROKE}
                      className="flex-shrink-0"
                    />
                    <span className="flex-1">{installedError}</span>
                    <button
                      onClick={loadInstalled}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-destructive/15 hover:bg-destructive/25 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {installedProbeFailures.length > 0 && (
                  <div className="flex items-start gap-2 px-4 py-2 border-b border-border/40 bg-destructive/10 text-[11px] text-destructive">
                    <AlertCircle
                      size={ICON_SIZE}
                      strokeWidth={ICON_STROKE}
                      className="flex-shrink-0 mt-px"
                    />
                    <div className="flex-1">
                      <div className="font-medium">List may be incomplete:</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {installedProbeFailures.map((f) => (
                          <li key={probeFailureKey(f)} className="font-mono">
                            {probeFailureLabel(f)} ({f.code})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {loadingInstalled ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-[12px]">Scanning installed skills...</span>
                  </div>
                ) : filteredInstalled.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground px-8 text-center">
                    <Search size={20} strokeWidth={ICON_STROKE} />
                    <span className="text-[12px]">
                      {installedList.length === 0
                        ? 'No skills installed yet. Switch to All to browse and install one.'
                        : 'No installed skills match your filters.'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 px-3 py-3">
                    {filteredInstalled.map((entry) => {
                      const cat = entry.catalog;
                      const isCustom = !cat;
                      const isSelected = isCustom
                        ? customInstalled?.skillName === entry.skillName
                        : selectedSkill !== null && skillKey(cat) === skillKey(selectedSkill);
                      return (
                        <button
                          key={entry.skillName}
                          onClick={() => {
                            if (cat) handleSelectSkill(cat);
                            else handleSelectCustom(entry);
                          }}
                          // Card-style row: each install gets its own bordered surface so
                          // adjacent rows don't blur together. Selection > custom > default
                          // for the bg, applied last so selection wins. The wrapper uses
                          // gap-2 instead of divide-y to give every row distinct edges.
                          className={`w-full text-left px-3 py-2.5 rounded-md border border-border/40 transition-colors hover:bg-accent/40 hover:border-border/70 ${
                            isCustom
                              ? 'bg-[hsl(var(--surface-2))]/50'
                              : 'bg-[hsl(var(--surface-1))]/40'
                          } ${isSelected ? 'bg-accent/60 border-primary/50' : ''}`}
                        >
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[12px] font-medium text-foreground truncate">
                                {cat ? displaySkillName(cat) : entry.skillName}
                              </span>
                              {cat?.repo === 'anthropics/skills' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary leading-none flex-shrink-0">
                                  Official
                                </span>
                              )}
                              {cat && <RestrictedBadge skill={cat} />}
                              {cat?.category && <CategoryBadge category={cat.category} />}
                              {isCustom && (
                                <Tooltip content="Installed locally but not present in the cached registry. Refresh, or it may live outside the top 10K by stars.">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-accent/60 text-muted-foreground leading-none flex-shrink-0">
                                    Custom
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                            {cat?.description && (
                              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                                {cat.description}
                              </p>
                            )}
                            <LocationChips
                              entry={entry}
                              projects={projects}
                              activeTasks={activeTasks}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : isInitialLoad ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[12px]">Building skills index...</span>
              </div>
            ) : searchError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <AlertCircle size={20} strokeWidth={ICON_STROKE} className="text-destructive" />
                <span className="text-[12px] text-destructive text-center">{searchError}</span>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={handleManualRefresh}
                    className="px-3 py-1.5 rounded-md text-[12px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleResetCache}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    Reset cache and refetch
                  </button>
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <Search size={20} strokeWidth={ICON_STROKE} />
                <span className="text-[12px]">No skills found</span>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {results.map((skill) => (
                  <button
                    key={skillKey(skill)}
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors ${
                      selectedSkill && skillKey(selectedSkill) === skillKey(skill)
                        ? 'bg-accent/60'
                        : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[12px] font-medium text-foreground truncate">
                            {displaySkillName(skill)}
                          </span>
                          {skill.repo === 'anthropics/skills' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary leading-none flex-shrink-0">
                              Official
                            </span>
                          )}
                          <RestrictedBadge skill={skill} />
                          <CategoryBadge category={skill.category} />
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {skill.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0 pt-0.5">
                        <Star size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        <span>{formatStars(skill.stars)}</span>
                      </div>
                    </div>
                  </button>
                ))}

                {showLoadMore && (
                  <div className="px-4 py-3">
                    <button
                      onClick={() => runSearch(query, category, pageOffset + results.length, true)}
                      disabled={searching}
                      className="w-full py-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border border-border/40 disabled:opacity-50"
                    >
                      {searching
                        ? 'Loading...'
                        : `Load more (${resultTotal - (pageOffset + results.length)} remaining)`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="w-[45%] overflow-y-auto">
            {selectedSkill ? (
              <div className="flex flex-col h-full">
                {/* Detail header */}
                <div className="px-5 pt-4 pb-3 border-b border-border/40">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-[14px] font-semibold text-foreground">
                      {displaySkillName(selectedSkill)}
                    </h3>
                    {selectedSkill.repo === 'anthropics/skills' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary leading-none">
                        Official
                      </span>
                    )}
                    <RestrictedBadge skill={selectedSkill} />
                    {customInstalled && (
                      <Tooltip content="Installed locally. No catalog entry — description and stars come from the SKILL.md file itself.">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent/60 text-muted-foreground leading-none">
                          Custom
                        </span>
                      </Tooltip>
                    )}
                  </div>

                  {selectedSkill.description && (
                    <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
                      {selectedSkill.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                    {/* Stars and GitHub link only make sense for catalog skills — custom
                        skills have no remote source. */}
                    {!customInstalled && (
                      <span className="flex items-center gap-1">
                        <Star size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        {formatStars(selectedSkill.stars)} stars
                      </span>
                    )}
                    {selectedSkill.category && <CategoryBadge category={selectedSkill.category} />}
                    {selectedSkill.repo && (
                      <Tooltip content={`Open on GitHub: ${skillGithubUrl(selectedSkill)}`}>
                        <button
                          onClick={() =>
                            window.electronAPI.openExternal(skillGithubUrl(selectedSkill))
                          }
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <ExternalLink size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                          {selectedSkill.repo}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* SKILL.md content */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {loadingContent ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 size={ICON_SIZE} className="animate-spin" />
                      <span className="text-[12px]">Loading...</span>
                    </div>
                  ) : skillContentError ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start gap-1.5 text-[12px] text-destructive">
                        <AlertCircle
                          size={ICON_SIZE}
                          strokeWidth={ICON_STROKE}
                          className="flex-shrink-0 mt-px"
                        />
                        <span>{skillContentError}</span>
                      </div>
                      <button
                        onClick={() => loadSkillContent(selectedSkill)}
                        className="self-start px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border border-border/40"
                      >
                        Retry
                      </button>
                    </div>
                  ) : skillContent === null ? (
                    <button
                      onClick={() => loadSkillContent(selectedSkill)}
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border border-border/40"
                    >
                      <FolderOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      View SKILL.md
                    </button>
                  ) : (
                    <pre className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words font-mono leading-relaxed">
                      {skillContent}
                    </pre>
                  )}
                </div>

                {/* Probe failures: paths that couldn't be read (e.g. EACCES). The user
                    should know their "not installed" view may be a false negative. */}
                {installStatus?.probeFailures && installStatus.probeFailures.length > 0 && (
                  <div className="px-5 py-2 border-t border-border/40 flex-shrink-0">
                    <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                      <AlertCircle
                        size={ICON_SIZE}
                        strokeWidth={ICON_STROKE}
                        className="flex-shrink-0 mt-px"
                      />
                      <div className="flex-1">
                        <div className="font-medium">Could not check install status:</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {installStatus.probeFailures.map((f) => (
                            <li key={probeFailureKey(f)} className="font-mono">
                              {probeFailureLabel(f)} ({f.code})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* IPC-level failure on the install check itself: distinct from per-path
                    probe failures, because here we don't even have a status to show. */}
                {installStatusError && (
                  <div className="px-5 py-2 border-t border-border/40 flex-shrink-0">
                    <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                      <AlertCircle
                        size={ICON_SIZE}
                        strokeWidth={ICON_STROKE}
                        className="flex-shrink-0 mt-px"
                      />
                      <span className="flex-1">{installStatusError}</span>
                    </div>
                  </div>
                )}

                {/* Installed status */}
                {installStatus &&
                  (installStatus.global || installStatus.installedPaths.length > 0) && (
                    <div className="px-5 py-2 border-t border-border/40 flex-shrink-0">
                      <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                        Installed in
                      </div>
                      <div className="space-y-1">
                        {installStatus.global && (
                          <div className="flex items-center justify-between gap-2 py-1 px-2 rounded-md bg-accent/30">
                            <div className="flex items-center gap-1.5 text-[11px] text-foreground min-w-0">
                              <Check
                                size={ICON_SIZE}
                                strokeWidth={ICON_STROKE}
                                className="text-[hsl(var(--git-added))] flex-shrink-0"
                              />
                              <span className="truncate">Global (~/.claude/skills/)</span>
                            </div>
                            <Tooltip content="Remove globally installed skill">
                              <button
                                onClick={() => handleUninstall({ kind: 'global' })}
                                disabled={uninstalling}
                                className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
                              >
                                <Trash2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                              </button>
                            </Tooltip>
                          </div>
                        )}
                        {installStatus.installedPaths.map((pp) => {
                          // The probe list mixes project paths and active task worktrees.
                          // Match the path back to the right scope so we can label it and
                          // target the right uninstall variant.
                          const matchedTask = activeTasks.find((t) => t.worktreePath === pp);
                          const matchedProject = matchedTask
                            ? null
                            : projects.find((p) => p.path === pp);
                          const target: SkillInstallTarget = matchedTask
                            ? { kind: 'task', worktreePath: pp }
                            : { kind: 'project', projectPath: pp };
                          const primaryLabel = matchedTask
                            ? matchedTask.taskName
                            : matchedProject?.name || pp;
                          const secondaryLabel = matchedTask ? matchedTask.projectName : null;
                          const removeTooltip = matchedTask
                            ? `Remove from task “${matchedTask.taskName}” (worktree in ${matchedTask.projectName})`
                            : `Remove from ${matchedProject?.name || pp}`;
                          const Icon = matchedTask ? GitBranch : Check;
                          return (
                            <div
                              key={pp}
                              className="flex items-center justify-between gap-2 py-1 px-2 rounded-md bg-accent/30"
                            >
                              <div className="flex items-center gap-1.5 text-[11px] text-foreground min-w-0">
                                <Icon
                                  size={ICON_SIZE}
                                  strokeWidth={ICON_STROKE}
                                  className={
                                    matchedTask
                                      ? 'text-muted-foreground flex-shrink-0'
                                      : 'text-[hsl(var(--git-added))] flex-shrink-0'
                                  }
                                />
                                <span className="truncate">
                                  {primaryLabel}
                                  {secondaryLabel && (
                                    <span className="ml-1 text-muted-foreground/70">
                                      · {secondaryLabel}
                                    </span>
                                  )}
                                </span>
                              </div>
                              <Tooltip content={removeTooltip}>
                                <button
                                  onClick={() =>
                                    handleUninstall(
                                      target,
                                      matchedTask ? matchedTask.taskName : matchedProject?.name,
                                    )
                                  }
                                  disabled={uninstalling}
                                  className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
                                >
                                  <Trash2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                                </button>
                              </Tooltip>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {/* Install actions — only meaningful for catalog skills. Custom skills
                    have no remote source to copy from, so the entire install picker is
                    hidden; uninstall still works via the per-location trash buttons in
                    the "Installed in" section above. */}
                <div className="px-5 py-3 border-t border-border/40 flex-shrink-0">
                  {installSuccess && (
                    <div className="flex items-center gap-2 mb-2 text-[11px] text-[hsl(var(--git-added))]">
                      <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      {installSuccess}
                    </div>
                  )}
                  {installError && (
                    <div className="flex items-center gap-2 mb-2 text-[11px] text-destructive">
                      <AlertCircle size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      {installError}
                    </div>
                  )}

                  <div className="relative flex items-center gap-2">
                    {installing || uninstalling ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground">
                        <Loader2 size={ICON_SIZE} className="animate-spin" />
                        {uninstalling ? 'Removing...' : 'Installing...'}
                      </div>
                    ) : customInstalled ? (
                      <p className="text-[11px] text-muted-foreground italic">
                        Custom skill — manage files directly on disk to install elsewhere.
                      </p>
                    ) : (
                      <>
                        <button
                          onClick={() => setShowInstallDropdown(!showInstallDropdown)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                          Install
                          <ChevronDown size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        </button>

                        {showInstallDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setShowInstallDropdown(false)}
                            />
                            <div className="absolute left-0 bottom-full mb-1 z-20 bg-card border border-border/60 rounded-lg shadow-xl py-1 min-w-[260px] max-h-[60vh] overflow-y-auto">
                              <button
                                onClick={() => handleInstall({ kind: 'global' })}
                                className="w-full text-left px-3 py-2 text-[12px] hover:bg-accent/60 transition-colors text-foreground flex items-center gap-2"
                              >
                                <Download
                                  size={ICON_SIZE}
                                  strokeWidth={ICON_STROKE}
                                  className="text-muted-foreground flex-shrink-0"
                                />
                                <div>
                                  <div className="font-medium">Global</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    ~/.claude/skills/
                                  </div>
                                </div>
                              </button>

                              {activeTasks.length > 0 && (
                                <div className="border-t border-border/30 mt-1 pt-1">
                                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                                    <span>Tasks</span>
                                    <Tooltip content="Files written here are uncommitted changes in the task's worktree.">
                                      <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                                        uncommitted
                                      </span>
                                    </Tooltip>
                                  </div>
                                  {activeTasks.map((t) => (
                                    <button
                                      key={t.taskId}
                                      onClick={() =>
                                        handleInstall(
                                          { kind: 'task', worktreePath: t.worktreePath },
                                          t.taskName,
                                        )
                                      }
                                      className={`w-full text-left px-3 py-2 text-[12px] hover:bg-accent/60 transition-colors text-foreground flex items-center gap-2 ${
                                        t.taskId === currentTaskId ? 'bg-accent/30' : ''
                                      }`}
                                    >
                                      <GitBranch
                                        size={ICON_SIZE}
                                        strokeWidth={ICON_STROKE}
                                        className="text-muted-foreground flex-shrink-0"
                                      />
                                      <div className="min-w-0">
                                        <div className="font-medium truncate">{t.taskName}</div>
                                        <div className="text-[10px] text-muted-foreground/80 truncate">
                                          {t.projectName}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {projects.length > 0 && (
                                <div className="border-t border-border/30 mt-1 pt-1">
                                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                    Projects
                                  </div>
                                  {projects.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() =>
                                        handleInstall(
                                          { kind: 'project', projectPath: p.path },
                                          p.name,
                                        )
                                      }
                                      className={`w-full text-left px-3 py-2 text-[12px] hover:bg-accent/60 transition-colors text-foreground flex items-center gap-2 ${p.id === activeProjectId ? 'bg-accent/30' : ''}`}
                                    >
                                      <FolderOpen
                                        size={ICON_SIZE}
                                        strokeWidth={ICON_STROKE}
                                        className="text-muted-foreground flex-shrink-0"
                                      />
                                      <div className="min-w-0">
                                        <div className="font-medium truncate">{p.name}</div>
                                        <div className="text-[10px] text-muted-foreground truncate">
                                          {p.path}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground px-8">
                <Blocks size={24} strokeWidth={1.5} />
                <p className="text-[12px] text-center leading-relaxed">
                  Select a skill to view details and install
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
