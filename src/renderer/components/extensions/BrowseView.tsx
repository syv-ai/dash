import React, { useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Loader2,
  Download,
  Check,
  Store,
  Github,
  ChevronLeft,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  ExtensionScopeRef,
  CatalogPlugin,
  RegistrySkill,
  ExtensionsOverview,
  PluginScope,
} from '../../../shared/types';
import { deriveSkillFolderName } from '../../../shared/skills';
import { Select } from '../ui/Select';
import { Segmented } from '../ui/Segmented';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { filterCatalogByMarketplace } from './extensionDerivations';
import { ScopeMultiSelect } from './ScopeMultiSelect';
import type { useExtensions } from './useExtensions';

type Ext = ReturnType<typeof useExtensions>;
type BrowseTab = 'plugins' | 'skills';
type SidebarMode = 'sources' | 'add-marketplace' | 'add-skill';

function installedScopeIdSet(
  overview: ExtensionsOverview | null,
  predicate: (s: ExtensionsOverview['scopes'][number]) => boolean,
): Set<string> {
  if (!overview) return new Set();
  return new Set(overview.scopes.filter(predicate).map((s) => s.scope.id));
}

export function BrowseView({ scopes, ext }: { scopes: ExtensionScopeRef[]; ext: Ext }) {
  const [tab, setTab] = useState<BrowseTab>('plugins');
  const [marketplace, setMarketplace] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<RegistrySkill[]>([]);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('sources');

  // Registry search: debounce keystrokes (one hit per pause, not per character) and
  // discard a superseded response so a slow earlier query can't overwrite a newer one.
  useEffect(() => {
    if (tab !== 'skills') return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void window.electronAPI.skillsSearch({ query, limit: 50, offset: 0 }).then((r) => {
        if (!cancelled && r.success && r.data) setSkills(r.data.skills);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tab, query]);
  // Reset the sidebar to its list whenever the tab changes.
  useEffect(() => setSidebarMode('sources'), [tab]);

  const catalog = ext.catalog;
  const marketplaces = ext.marketplaces;
  const overview = ext.overview;

  const visibleCatalog = filterCatalogByMarketplace(catalog, marketplace).filter(
    (p) => !query || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-border/40 px-5 py-2.5">
        <Segmented
          value={tab}
          onChange={(t) => setTab(t)}
          fullWidth={false}
          size="sm"
          options={[
            { value: 'plugins', label: 'Plugins' },
            { value: 'skills', label: 'Skills' },
          ]}
        />
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 focus-within:border-primary/40">
          <Search size={13} className="text-foreground/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-48 bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/35"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* source sidebar */}
        <div
          className="w-[210px] flex-shrink-0 overflow-y-auto p-2"
          style={{ background: 'hsl(var(--surface-0))' }}
        >
          {tab === 'plugins' ? (
            sidebarMode === 'add-marketplace' ? (
              <AddMarketplaceForm
                scopes={scopes}
                ext={ext}
                onDone={() => setSidebarMode('sources')}
              />
            ) : (
              <div className="space-y-0.5">
                <SourceRow
                  label="All sources"
                  active={marketplace === null}
                  onClick={() => setMarketplace(null)}
                />
                {marketplaces.map((m) => (
                  <SourceRow
                    key={m.name}
                    label={m.name}
                    active={marketplace === m.name}
                    onClick={() => setMarketplace(m.name)}
                    busy={ext.busy === `mkt-rm:${m.name}`}
                    onRemove={() => {
                      if (marketplace === m.name) setMarketplace(null);
                      void ext.removeMarketplace(m.name);
                    }}
                  />
                ))}
                <button
                  onClick={() => setSidebarMode('add-marketplace')}
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  <Plus size={13} strokeWidth={1.8} className="flex-shrink-0 text-foreground/40" />
                  Add marketplace
                </button>
              </div>
            )
          ) : (
            <div className="space-y-0.5">
              <SourceRow label="Skills registry" active onClick={() => undefined} />
              <p className="px-2.5 py-1 text-[10.5px] leading-relaxed text-foreground/40">
                Community index{' '}
                <span className="font-mono text-foreground/55">
                  majiayu000/claude-skill-registry
                </span>{' '}
                — ranked by GitHub stars.
              </p>
              <button
                onClick={() =>
                  setSidebarMode(sidebarMode === 'add-skill' ? 'sources' : 'add-skill')
                }
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <Plus size={13} strokeWidth={1.8} className="flex-shrink-0 text-foreground/40" />
                Add skill from a repo
              </button>
              {sidebarMode === 'add-skill' && (
                <AddSkillForm scopes={scopes} ext={ext} onDone={() => setSidebarMode('sources')} />
              )}
            </div>
          )}
        </div>

        {/* catalog */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'plugins' ? (
            <div className="space-y-1.5">
              {visibleCatalog.map((p: CatalogPlugin) => (
                <CatalogRow
                  key={p.id}
                  title={p.name}
                  source={p.marketplace}
                  sourceIcon={<Store size={11} strokeWidth={1.8} />}
                  description={p.description}
                  scopes={scopes}
                  installedScopeIds={installedScopeIdSet(overview, (s) =>
                    s.plugins.some((x) => x.id === p.id),
                  )}
                  busy={ext.busy === `add:${p.id}`}
                  onAdd={(targets) => void ext.installPluginToScopes(p.id, targets)}
                  onOpen={() =>
                    void ext.openDetail({
                      kind: 'plugin',
                      pluginId: p.id,
                      name: p.name,
                      marketplace: p.marketplace,
                      version: p.version,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {skills.map((s) => {
                const folder = deriveSkillFolderName(s) || s.name;
                return (
                  <CatalogRow
                    key={`${s.repo}/${s.path}`}
                    title={s.name}
                    source={s.repo}
                    sourceIcon={<Github size={11} strokeWidth={1.8} />}
                    description={s.description}
                    scopes={scopes}
                    installedScopeIds={installedScopeIdSet(overview, (sc) =>
                      sc.skills.some((x) => x.name === folder),
                    )}
                    busy={ext.busy === `add:${folder}`}
                    onAdd={(targets) =>
                      void ext.installSkillToScopes(
                        { repo: s.repo, path: s.path, branch: s.branch },
                        folder,
                        targets,
                      )
                    }
                    onOpen={() =>
                      void ext.openDetail({
                        kind: 'skill',
                        skillName: folder,
                        fromRegistry: true,
                        // Not installed yet — fetch SKILL.md from the registry by ref.
                        source: {
                          kind: 'registry',
                          ref: { repo: s.repo, path: s.path, branch: s.branch },
                        },
                      })
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  label,
  active,
  onClick,
  onRemove,
  busy,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Present only for removable (real) marketplaces — shows a trash button on hover. */
  onRemove?: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className={`group flex w-full items-center rounded-md transition-colors ${
        active
          ? 'bg-[hsl(var(--surface-3))] text-foreground'
          : 'text-foreground/60 hover:bg-accent/50 hover:text-foreground'
      }`}
    >
      <button
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-[12px]"
      >
        <Store size={13} strokeWidth={1.8} className="flex-shrink-0 text-foreground/40" />
        <span className="truncate">{label}</span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={busy}
          title="Remove marketplace"
          className="flex-shrink-0 px-2 py-1.5 text-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} strokeWidth={1.8} />
          )}
        </button>
      )}
    </div>
  );
}

function AddMarketplaceForm({
  scopes,
  ext,
  onDone,
}: {
  scopes: ExtensionScopeRef[];
  ext: Ext;
  onDone: () => void;
}) {
  const projects = scopes.filter((s) => s.kind === 'project');
  const [source, setSource] = useState('');
  const [scopeValue, setScopeValue] = useState('user');
  const [sparse, setSparse] = useState('');
  const busy = ext.busy === `mkt:${source.trim()}`;

  const submit = () => {
    const src = source.trim();
    if (!src) return;
    const project = projects.find((p) => p.id === scopeValue);
    const opts: { scope?: PluginScope; cwd?: string; sparse?: string[] } = project
      ? { scope: 'project', cwd: project.path }
      : { scope: 'user' };
    const paths = sparse
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paths.length) opts.sparse = paths;
    void ext.addMarketplace(src, opts).then(onDone);
  };

  return (
    <div className="space-y-2.5 px-1 pt-1">
      <button
        onClick={onDone}
        className="flex items-center gap-1 text-[11px] text-foreground/55 hover:text-foreground"
      >
        <ChevronLeft size={12} /> Sources
      </button>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
        Add marketplace
      </div>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        rows={2}
        placeholder="owner/repo, git URL, local path, or marketplace.json URL"
        className="w-full resize-none rounded-lg border border-border/60 bg-transparent px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground/35 focus:border-primary/40"
      />
      <div className="space-y-1">
        <label className="block text-[10px] uppercase tracking-[0.08em] text-foreground/45">
          Scope
        </label>
        <Select
          value={scopeValue}
          onValueChange={setScopeValue}
          className="w-full py-1.5"
          options={[
            { value: 'user', label: 'User (global)' },
            ...projects.map((p) => ({ value: p.id, label: `Project · ${p.name}` })),
          ]}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[10px] uppercase tracking-[0.08em] text-foreground/45">
          Sparse paths <span className="normal-case text-foreground/30">(monorepo, optional)</span>
        </label>
        <input
          value={sparse}
          onChange={(e) => setSparse(e.target.value)}
          placeholder=".claude-plugin plugins"
          className="w-full rounded-lg border border-border/60 bg-transparent px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground/35 focus:border-primary/40"
        />
      </div>
      <Button size="sm" className="w-full" disabled={!source.trim() || busy} onClick={submit}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add marketplace
      </Button>
    </div>
  );
}

function AddSkillForm({
  scopes,
  ext,
  onDone,
}: {
  scopes: ExtensionScopeRef[];
  ext: Ext;
  onDone: () => void;
}) {
  const [repo, setRepo] = useState('');
  const [path, setPath] = useState('');
  const [branch, setBranch] = useState('main');
  // Derive the install folder the same way the catalog does — handling a trailing
  // `/SKILL.md` and sanitizing — so the badge matches and the install lands correctly.
  const folder = deriveSkillFolderName({ name: '', path: path.trim() });
  const ready = repo.trim() !== '' && path.trim() !== '' && folder !== '';
  const busy = ext.busy === `add:${folder}`;

  const field =
    'w-full rounded-lg border border-border/60 bg-transparent px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground/35 focus:border-primary/40';

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-border/50 p-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-foreground/45">
        Add skill from a repo
      </div>
      <input
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        placeholder="owner/repo"
        className={field}
      />
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="path/to/skill"
        className={field}
      />
      <input
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        placeholder="branch"
        className={field}
      />
      <ScopeMultiSelect
        scopes={scopes}
        installedScopeIds={new Set()}
        busy={busy}
        onAdd={(targets) =>
          void ext
            .installSkillToScopes(
              { repo: repo.trim(), path: path.trim(), branch: branch.trim() },
              folder,
              targets,
            )
            .then(onDone)
        }
      >
        <Button size="sm" className="w-full" disabled={!ready} variant="secondary">
          <Sparkles size={12} /> Choose scopes…
        </Button>
      </ScopeMultiSelect>
    </div>
  );
}

function InstallBadge({ scopeIds, names }: { scopeIds: Set<string>; names: string[] }) {
  if (scopeIds.size === 0) return null;
  const label = names.length === 1 ? names[0] : `${names.length} scopes`;
  return (
    <Tooltip content={`Installed in: ${names.join(', ')}`}>
      <span className="inline-flex items-center gap-1 rounded-[5px] bg-[hsl(var(--git-added)/0.16)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--git-added))]">
        <Check size={10} strokeWidth={2.5} /> {label}
      </span>
    </Tooltip>
  );
}

function CatalogRow({
  title,
  source,
  sourceIcon,
  description,
  scopes,
  installedScopeIds,
  busy,
  onAdd,
  onOpen,
}: {
  title: string;
  source: string;
  sourceIcon: React.ReactNode;
  description?: string;
  scopes: ExtensionScopeRef[];
  installedScopeIds: Set<string>;
  busy: boolean;
  onAdd: (targets: ExtensionScopeRef[]) => void;
  onOpen: () => void;
}) {
  const installedNames = scopes.filter((s) => installedScopeIds.has(s.id)).map((s) => s.name);
  return (
    <div
      className="flex items-start gap-3 rounded-[13px] px-3.5 py-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)]"
      style={{ background: 'hsl(var(--surface-3))' }}
    >
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground hover:underline">
            {title}
          </span>
          <InstallBadge scopeIds={installedScopeIds} names={installedNames} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground/70">
          <span className="flex-shrink-0 text-foreground/45">{sourceIcon}</span>
          <span className="truncate">{source}</span>
        </div>
        {description && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground/45">
            {description}
          </div>
        )}
      </button>
      <ScopeMultiSelect
        scopes={scopes}
        installedScopeIds={installedScopeIds}
        busy={busy}
        onAdd={onAdd}
      >
        <Button size="sm" disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Add
        </Button>
      </ScopeMultiSelect>
    </div>
  );
}
