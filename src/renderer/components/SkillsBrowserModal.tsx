import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Trash2,
} from 'lucide-react';
import type { RegistrySkill, SkillInstallStatus } from '../../shared/types';

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

interface SkillsBrowserModalProps {
  projects: ProjectInfo[];
  activeProjectId?: string;
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

function CategoryBadge({ category }: { category: string }) {
  if (!category) return null;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/60 text-muted-foreground leading-none">
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

export function SkillsBrowserModal({
  projects,
  activeProjectId,
  onClose,
}: SkillsBrowserModalProps) {
  const [closing, setClosing] = useState(false);
  const [skills, setSkills] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<RegistrySkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showInstallDropdown, setShowInstallDropdown] = useState(false);
  const [installStatus, setInstallStatus] = useState<SkillInstallStatus | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(50);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [filteredSkills, setFilteredSkills] = useState<RegistrySkill[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
  }, []);

  // Escape to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Focus search on open
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSkills();
  }, []);

  // Search/filter when query or category changes
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      filterSkills();
    }, 200);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, category, skills]);

  async function fetchSkills(forceRefresh = false) {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.skillsFetchRegistry(
        forceRefresh ? { forceRefresh: true } : undefined,
      );
      if (result.success && result.data) {
        setSkills(result.data);
        // Extract categories
        const cats = new Set<string>();
        for (const s of result.data) {
          if (s.category) cats.add(s.category);
        }
        setCategories(Array.from(cats).sort());
      } else {
        setError(result.error || 'Failed to load skills registry');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function filterSkills() {
    const q = query.toLowerCase().trim();
    let result = skills;

    if (q) {
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.repo.toLowerCase().includes(q),
      );
    }

    if (category) {
      result = result.filter((s) => s.category === category);
    }

    // Pin official skills at the top
    result.sort((a, b) => {
      const aOfficial = a.repo === 'anthropics/skills' ? 1 : 0;
      const bOfficial = b.repo === 'anthropics/skills' ? 1 : 0;
      if (aOfficial !== bOfficial) return bOfficial - aOfficial;
      return 0; // Keep original star-based order otherwise
    });

    setFilteredSkills(result);
    setFilteredTotal(result.length);
    setDisplayLimit(50);
  }

  async function loadSkillContent(skill: RegistrySkill) {
    setLoadingContent(true);
    setSkillContent(null);
    try {
      const result = await window.electronAPI.skillsGetContent({
        repo: skill.repo,
        path: skill.path,
        branch: skill.branch,
      });
      if (result.success && result.data) {
        setSkillContent(result.data);
      } else {
        setSkillContent(`Failed to load: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      setSkillContent(`Failed to load: ${err}`);
    } finally {
      setLoadingContent(false);
    }
  }

  function handleSelectSkill(skill: RegistrySkill) {
    setSelectedSkill(skill);
    setSkillContent(null);
    setInstallSuccess(null);
    setInstallError(null);
    setInstallStatus(null);
    checkInstallStatus(skill);
  }

  async function checkInstallStatus(skill: RegistrySkill) {
    const skillName = skill.name.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    try {
      const result = await window.electronAPI.skillsCheckInstalled({
        skillName,
        projectPaths: projects.map((p) => p.path),
      });
      if (result.success && result.data) {
        setInstallStatus(result.data);
      }
    } catch {
      // Non-critical
    }
  }

  async function handleUninstall(
    target: 'global' | 'project',
    projectPath?: string,
    projectName?: string,
  ) {
    if (!selectedSkill) return;
    setUninstalling(true);
    setInstallSuccess(null);
    setInstallError(null);

    const skillName = selectedSkill.name.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    try {
      const result = await window.electronAPI.skillsUninstall({
        skillName,
        target,
        projectPath,
      });
      if (result.success) {
        setInstallSuccess(
          target === 'global'
            ? `Removed from ~/.claude/skills/${skillName}/`
            : `Removed from ${projectName || 'project'}`,
        );
        checkInstallStatus(selectedSkill);
      } else {
        setInstallError(result.error || 'Removal failed');
      }
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setUninstalling(false);
    }
  }

  async function handleInstall(
    target: 'global' | 'project',
    projectPath?: string,
    projectName?: string,
  ) {
    if (!selectedSkill) return;
    setInstalling(true);
    setInstallSuccess(null);
    setInstallError(null);
    setShowInstallDropdown(false);

    // Derive a clean skill name from the registry name
    const skillName = selectedSkill.name.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    try {
      const result = await window.electronAPI.skillsInstall({
        repo: selectedSkill.repo,
        path: selectedSkill.path,
        branch: selectedSkill.branch,
        skillName,
        target,
        projectPath: target === 'project' ? projectPath : undefined,
      });
      if (result.success) {
        setInstallSuccess(
          target === 'global'
            ? `Installed to ~/.claude/skills/${skillName}/`
            : `Installed to ${projectName || 'project'}/.claude/skills/${skillName}/`,
        );
        checkInstallStatus(selectedSkill);
      } else {
        setInstallError(result.error || 'Installation failed');
      }
    } catch (err) {
      setInstallError(String(err));
    } finally {
      setInstalling(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleClose();
  }

  const displayedSkills = filteredSkills.slice(0, displayLimit);

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
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Blocks size={14} className="text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
            <span className="text-[13px] font-medium text-foreground">Skills Browser</span>
            {!loading && (
              <span className="text-[11px] text-muted-foreground">
                {filteredTotal} skill{filteredTotal !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchSkills(true)}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-150 disabled:opacity-40"
              title="Refresh registry"
            >
              <RefreshCw size={13} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-150"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background border border-border/60 focus-within:border-primary/40 transition-colors">
            <Search size={13} className="text-muted-foreground flex-shrink-0" strokeWidth={2} />
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
                <X size={11} strokeWidth={2} />
              </button>
            )}
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
              <ChevronDown size={11} className="text-muted-foreground flex-shrink-0" />
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
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[12px]">Loading skills registry...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <AlertCircle size={20} className="text-destructive" />
                <span className="text-[12px] text-destructive text-center">{error}</span>
                <button
                  onClick={() => fetchSkills(true)}
                  className="px-3 py-1.5 rounded-md text-[12px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : displayedSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <Search size={20} />
                <span className="text-[12px]">No skills found</span>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {displayedSkills.map((skill) => (
                  <button
                    key={`${skill.repo}-${skill.name}`}
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors ${
                      selectedSkill?.name === skill.name && selectedSkill?.repo === skill.repo
                        ? 'bg-accent/60'
                        : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[12px] font-medium text-foreground truncate">
                            {skill.name}
                          </span>
                          {skill.repo === 'anthropics/skills' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary leading-none flex-shrink-0">
                              Official
                            </span>
                          )}
                          <CategoryBadge category={skill.category} />
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {skill.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0 pt-0.5">
                        <Star size={10} strokeWidth={2} />
                        <span>{formatStars(skill.stars)}</span>
                      </div>
                    </div>
                  </button>
                ))}

                {displayLimit < filteredTotal && (
                  <div className="px-4 py-3">
                    <button
                      onClick={() => setDisplayLimit((l) => l + 50)}
                      className="w-full py-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border border-border/40"
                    >
                      Load more ({filteredTotal - displayLimit} remaining)
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
                      {selectedSkill.name}
                    </h3>
                    {selectedSkill.repo === 'anthropics/skills' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary leading-none">
                        Official
                      </span>
                    )}
                  </div>

                  <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
                    {selectedSkill.description}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Star size={10} strokeWidth={2} />
                      {formatStars(selectedSkill.stars)} stars
                    </span>
                    {selectedSkill.category && <CategoryBadge category={selectedSkill.category} />}
                    <button
                      onClick={() =>
                        window.electronAPI.openExternal(`https://github.com/${selectedSkill.repo}`)
                      }
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      <ExternalLink size={10} strokeWidth={2} />
                      {selectedSkill.repo}
                    </button>
                  </div>
                </div>

                {/* SKILL.md content */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {skillContent === null && !loadingContent ? (
                    <button
                      onClick={() => loadSkillContent(selectedSkill)}
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border border-border/40"
                    >
                      <FolderOpen size={12} strokeWidth={2} />
                      View SKILL.md
                    </button>
                  ) : loadingContent ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-[12px]">Loading...</span>
                    </div>
                  ) : (
                    <pre className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words font-mono leading-relaxed">
                      {skillContent}
                    </pre>
                  )}
                </div>

                {/* Installed status */}
                {installStatus &&
                  (installStatus.global || installStatus.projectPaths.length > 0) && (
                    <div className="px-5 py-2 border-t border-border/40 flex-shrink-0">
                      <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                        Installed in
                      </div>
                      <div className="space-y-1">
                        {installStatus.global && (
                          <div className="flex items-center justify-between gap-2 py-1 px-2 rounded-md bg-accent/30">
                            <div className="flex items-center gap-1.5 text-[11px] text-foreground min-w-0">
                              <Check
                                size={11}
                                strokeWidth={2}
                                className="text-[hsl(var(--git-added))] flex-shrink-0"
                              />
                              <span className="truncate">Global (~/.claude/skills/)</span>
                            </div>
                            <button
                              onClick={() => handleUninstall('global')}
                              disabled={uninstalling}
                              className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
                              title="Remove"
                            >
                              <Trash2 size={11} strokeWidth={2} />
                            </button>
                          </div>
                        )}
                        {installStatus.projectPaths.map((pp) => {
                          const proj = projects.find((p) => p.path === pp);
                          return (
                            <div
                              key={pp}
                              className="flex items-center justify-between gap-2 py-1 px-2 rounded-md bg-accent/30"
                            >
                              <div className="flex items-center gap-1.5 text-[11px] text-foreground min-w-0">
                                <Check
                                  size={11}
                                  strokeWidth={2}
                                  className="text-[hsl(var(--git-added))] flex-shrink-0"
                                />
                                <span className="truncate">{proj?.name || pp}</span>
                              </div>
                              <button
                                onClick={() => handleUninstall('project', pp, proj?.name)}
                                disabled={uninstalling}
                                className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-40"
                                title="Remove"
                              >
                                <Trash2 size={11} strokeWidth={2} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {/* Install actions */}
                <div className="px-5 py-3 border-t border-border/40 flex-shrink-0">
                  {installSuccess && (
                    <div className="flex items-center gap-2 mb-2 text-[11px] text-[hsl(var(--git-added))]">
                      <Check size={12} strokeWidth={2} />
                      {installSuccess}
                    </div>
                  )}
                  {installError && (
                    <div className="flex items-center gap-2 mb-2 text-[11px] text-destructive">
                      <AlertCircle size={12} strokeWidth={2} />
                      {installError}
                    </div>
                  )}

                  <div className="relative flex items-center gap-2">
                    {installing || uninstalling ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" />
                        {uninstalling ? 'Removing...' : 'Installing...'}
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setShowInstallDropdown(!showInstallDropdown)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Download size={12} strokeWidth={2} />
                          Install
                          <ChevronDown size={11} />
                        </button>

                        {showInstallDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setShowInstallDropdown(false)}
                            />
                            <div className="absolute left-0 bottom-full mb-1 z-20 bg-card border border-border/60 rounded-lg shadow-xl py-1 min-w-[220px]">
                              <button
                                onClick={() => handleInstall('global')}
                                className="w-full text-left px-3 py-2 text-[12px] hover:bg-accent/60 transition-colors text-foreground flex items-center gap-2"
                              >
                                <Download
                                  size={12}
                                  strokeWidth={2}
                                  className="text-muted-foreground flex-shrink-0"
                                />
                                <div>
                                  <div className="font-medium">Global</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    ~/.claude/skills/
                                  </div>
                                </div>
                              </button>

                              {projects.length > 0 && (
                                <div className="border-t border-border/30 mt-1 pt-1">
                                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                    Projects
                                  </div>
                                  {projects.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() => handleInstall('project', p.path, p.name)}
                                      className={`w-full text-left px-3 py-2 text-[12px] hover:bg-accent/60 transition-colors text-foreground flex items-center gap-2 ${p.id === activeProjectId ? 'bg-accent/30' : ''}`}
                                    >
                                      <FolderOpen
                                        size={12}
                                        strokeWidth={2}
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
