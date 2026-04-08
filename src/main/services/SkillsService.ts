import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import path from 'path';
import type { RegistrySkill, SkillsSearchResult, SkillInstallStatus } from '@shared/types';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/majiayu000/claude-skill-registry/main/registry.json';
const MAX_SKILLS = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 60_000; // 60s for the large registry download

interface SkillsCache {
  fetchedAt: number;
  skills: RegistrySkill[];
}

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'skills-cache.json');
}

function readCache(): SkillsCache | null {
  try {
    const raw = readFileSync(getCachePath(), 'utf-8');
    return JSON.parse(raw) as SkillsCache;
  } catch {
    return null;
  }
}

function writeCache(cache: SkillsCache): void {
  writeFileSync(getCachePath(), JSON.stringify(cache));
}

export class SkillsService {
  static async fetchRegistry(forceRefresh = false): Promise<RegistrySkill[]> {
    if (!forceRefresh) {
      const cache = readCache();
      if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.skills;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(REGISTRY_URL, {
        headers: { 'Accept-Encoding': 'gzip' },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Registry fetch failed: ${resp.status}`);
      }

      const data = (await resp.json()) as {
        skills: RegistrySkill[];
      };

      // Registry is sorted by stars descending; take top N
      const skills = (data.skills || []).slice(0, MAX_SKILLS).map((s) => ({
        name: s.name || '',
        description: s.description || '',
        repo: s.repo || '',
        path: s.path || '',
        branch: s.branch || 'main',
        category: s.category || '',
        tags: Array.isArray(s.tags) ? s.tags : [],
        stars: s.stars || 0,
        source: s.source || '',
      }));

      writeCache({ fetchedAt: Date.now(), skills });
      return skills;
    } finally {
      clearTimeout(timeout);
    }
  }

  static async search(
    query: string,
    category?: string,
    limit = 50,
    offset = 0,
  ): Promise<SkillsSearchResult> {
    const all = await this.fetchRegistry();
    const q = query.toLowerCase().trim();

    let filtered = all;

    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.repo.toLowerCase().includes(q),
      );
    }

    if (category) {
      filtered = filtered.filter((s) => s.category === category);
    }

    return {
      skills: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  static async getSkillContent(repo: string, skillPath: string, branch: string): Promise<string> {
    // Determine the SKILL.md URL
    const normalizedPath = skillPath.endsWith('SKILL.md')
      ? skillPath
      : skillPath.endsWith('/')
        ? `${skillPath}SKILL.md`
        : `${skillPath}/SKILL.md`;

    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${normalizedPath}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`Failed to fetch SKILL.md: ${resp.status}`);
      }
      return await resp.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  static async installSkill(args: {
    repo: string;
    path: string;
    branch: string;
    skillName: string;
    target: 'global' | 'project';
    projectPath?: string;
  }): Promise<void> {
    const { repo, path: skillPath, branch, skillName, target, projectPath } = args;

    // Determine install directory
    let installDir: string;
    if (target === 'project' && projectPath) {
      installDir = path.join(projectPath, '.claude', 'skills', skillName);
    } else {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      installDir = path.join(home, '.claude', 'skills', skillName);
    }

    mkdirSync(installDir, { recursive: true });

    // Fetch the SKILL.md content
    const content = await this.getSkillContent(repo, skillPath, branch);
    writeFileSync(path.join(installDir, 'SKILL.md'), content, 'utf-8');

    // Try to fetch additional files in the skill directory
    await this.fetchSkillDirectory(repo, skillPath, branch, installDir);
  }

  private static async fetchSkillDirectory(
    repo: string,
    skillPath: string,
    branch: string,
    installDir: string,
  ): Promise<void> {
    // Normalize: remove trailing SKILL.md if present
    const dirPath = skillPath.endsWith('SKILL.md')
      ? skillPath.replace(/\/?SKILL\.md$/, '')
      : skillPath;

    if (!dirPath) return;

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${dirPath}?ref=${branch}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal: controller.signal,
      });

      if (!resp.ok) return; // Non-critical: we already have SKILL.md

      const entries = (await resp.json()) as Array<{
        name: string;
        type: string;
        download_url: string | null;
        path: string;
      }>;

      for (const entry of entries) {
        if (entry.name === 'SKILL.md') continue; // Already saved
        if (entry.type === 'file' && entry.download_url) {
          const fileResp = await fetch(entry.download_url);
          if (fileResp.ok) {
            const fileContent = await fileResp.text();
            writeFileSync(path.join(installDir, entry.name), fileContent, 'utf-8');
          }
        } else if (entry.type === 'dir') {
          // Fetch subdirectory contents
          const subDir = path.join(installDir, entry.name);
          mkdirSync(subDir, { recursive: true });
          await this.fetchSkillDirectory(repo, entry.path, branch, subDir);
        }
      }
    } catch {
      // Non-critical: we already have the SKILL.md
    } finally {
      clearTimeout(timeout);
    }
  }

  static getCategories(skills: RegistrySkill[]): string[] {
    const cats = new Set<string>();
    for (const s of skills) {
      if (s.category) cats.add(s.category);
    }
    return Array.from(cats).sort();
  }

  static checkInstalled(skillName: string, projectPaths: string[]): SkillInstallStatus {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const globalPath = path.join(home, '.claude', 'skills', skillName, 'SKILL.md');
    const global = existsSync(globalPath);

    const projectIds: string[] = [];
    for (const pp of projectPaths) {
      const projectSkillPath = path.join(pp, '.claude', 'skills', skillName, 'SKILL.md');
      if (existsSync(projectSkillPath)) {
        projectIds.push(pp);
      }
    }

    return { global, projectPaths: projectIds };
  }

  static uninstallSkill(args: {
    skillName: string;
    target: 'global' | 'project';
    projectPath?: string;
  }): void {
    const { skillName, target, projectPath } = args;

    let skillDir: string;
    if (target === 'project' && projectPath) {
      skillDir = path.join(projectPath, '.claude', 'skills', skillName);
    } else {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      skillDir = path.join(home, '.claude', 'skills', skillName);
    }

    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
    }
  }
}
