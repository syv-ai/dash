import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MEMORY_INDEX_FILE, type MemoryEntry, type ProjectMemory } from '@shared/types';
import { claudeProjectDir } from '../utils/claudePaths';
import { parseIndexLinks, parseMemoryFile } from './memoryFiles';

const execFileAsync = promisify(execFile);

/**
 * The directory Claude Code keys a project's auto-memory by: the main
 * checkout of the git repo `projectPath` lives in, so every linked worktree
 * (and a monorepo subfolder) shares one memory. Outside git, the path itself.
 */
async function resolveMemoryRoot(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: projectPath },
    );
    const commonDir = stdout.trim();
    return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : projectPath;
  } catch {
    return projectPath;
  }
}

/** A project's auto-memory folder. Every caller goes through this: how the
 *  folder is found (root resolution, encoding, config dir) stays private. */
export async function resolveMemoryDir(projectPath: string): Promise<string> {
  return path.join(claudeProjectDir(await resolveMemoryRoot(projectPath)), 'memory');
}

async function readEntry(
  dir: string,
  file: string,
  indexed: Set<string>,
): Promise<MemoryEntry | null> {
  const full = path.join(dir, file);
  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(full, 'utf8'),
      fs.promises.stat(full),
    ]);
    const parsed = parseMemoryFile(content);
    return {
      file,
      name: parsed.name || file.replace(/\.md$/, ''),
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      mtimeMs: stat.mtimeMs,
      inIndex: indexed.has(file),
    };
  } catch {
    // Deleted between readdir and read (Claude rewrites memories mid-session).
    return null;
  }
}

/** Read the project's memory folder. A missing folder is a normal state, not an error. */
export async function readProjectMemory(projectPath: string): Promise<ProjectMemory> {
  const dir = await resolveMemoryDir(projectPath);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return { dir, exists: false, index: null, entries: [] };
  }
  const index = names.includes(MEMORY_INDEX_FILE)
    ? await fs.promises.readFile(path.join(dir, MEMORY_INDEX_FILE), 'utf8').catch(() => null)
    : null;
  const indexed = index ? parseIndexLinks(index) : new Set<string>();
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith('.md') && n !== MEMORY_INDEX_FILE)
      .map((file) => readEntry(dir, file, indexed)),
  );
  return {
    dir,
    exists: true,
    index,
    entries: entries.filter((e): e is MemoryEntry => e !== null),
  };
}
