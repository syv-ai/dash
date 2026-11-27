/**
 * What the New Project dialog's one input names: a folder on disk (an existing
 * repo, an existing folder, a folder to create), a remote to clone (GitHub,
 * Azure DevOps, any other git host), or nothing usable yet. Pure: what a path
 * is on disk comes in as `PathFacts`, from main's `projectInspectPath`.
 */

import type { PathFacts } from '@shared/pathFacts';
import { parseAdoRemote } from '@shared/urls';

export type { PathFacts };

export type RemoteKind = 'github' | 'ado' | 'other-git';

export type Source =
  | { kind: 'empty' }
  /** A path whose facts haven't come back yet. */
  | { kind: 'checking' }
  | { kind: 'local-repo' | 'local-folder' | 'new-folder'; path: string; name: string }
  /** The folder already is a project: opening it is all there is to do. */
  | { kind: 'project'; projectId: string; name: string }
  | { kind: RemoteKind; url: string; name: string }
  | { kind: 'invalid'; reason: string };

export type SourceKind = Source['kind'];

/** A path is absolute or from the home folder; anything else is a URL or junk. */
export function isPathInput(raw: string): boolean {
  const s = raw.trim();
  return s.startsWith('/') || s === '~' || s.startsWith('~/');
}

const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;
/** `owner/repo`, GitHub's own shorthand (gh, the web UI). */
const GITHUB_SHORTHAND = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/;
/** `user@host:path`, git's scp-like ssh syntax. */
const SCP_LIKE = /^[\w.-]+@([\w.-]+):(.+)$/;
const URL_SCHEME = /^(https?|ssh|git|file):\/\//i;

const ADO_HOST = /(^|\.)(dev\.azure\.com|visualstudio\.com)$/i;

/** The last path segment, less `.git` and trailing slashes. */
function repoName(pathPart: string): string {
  const last = pathPart.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replace(/\.git$/i, '');
}

function githubHttps(owner: string, repo: string): Source {
  const name = repo.replace(/\.git$/i, '');
  return { kind: 'github', url: `https://github.com/${owner}/${name}.git`, name };
}

function classifyRemote(s: string): Source | null {
  const scp = SCP_LIKE.exec(s);
  if (scp) {
    const [, host, rest] = scp as unknown as [string, string, string];
    return remote(host, s, rest);
  }

  if (/^github\.com\//i.test(s)) return classifyRemote(`https://${s}`);

  if (URL_SCHEME.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return { kind: 'invalid', reason: 'Not a URL git can clone.' };
    }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    // A browser URL (…/tree/main, ?query) still names the repository.
    if (host === 'github.com' && /^https?:$/.test(url.protocol)) {
      const [owner, repo] = segments;
      if (!owner || !repo) return { kind: 'invalid', reason: 'Name a repository: owner/repo.' };
      return githubHttps(owner, repo);
    }
    const clean = `${url.protocol}//${url.username ? `${url.username}@` : ''}${url.host}${url.pathname}`;
    return remote(host, clean, url.pathname);
  }

  const short = GITHUB_SHORTHAND.exec(s);
  if (short && GITHUB_SEGMENT.test(short[2]!)) return githubHttps(short[1]!, short[2]!);

  return null;
}

function remote(host: string, url: string, pathPart: string): Source {
  const h = host.toLowerCase();
  // ADO's own parser names the repository decoded (a name may have spaces).
  const name = (ADO_HOST.test(h) && parseAdoRemote(url)?.repository) || repoName(pathPart);
  if (!name) return { kind: 'invalid', reason: 'The URL names no repository.' };
  const kind: RemoteKind = h === 'github.com' ? 'github' : ADO_HOST.test(h) ? 'ado' : 'other-git';
  return { kind, url, name };
}

function classifyPath(facts: PathFacts): Source {
  const { path, project } = facts;
  if (project) {
    if (project.archived) {
      return { kind: 'invalid', reason: `The archived project ${project.name}; restore it first.` };
    }
    if (project.relation === 'same') {
      return { kind: 'project', projectId: project.id, name: project.name };
    }
    return {
      kind: 'invalid',
      reason:
        project.relation === 'inside'
          ? `Inside the project ${project.name}.`
          : `A worktree of the project ${project.name}.`,
    };
  }
  const name = repoName(path) || path;
  if (facts.exists) {
    if (!facts.isDirectory) return { kind: 'invalid', reason: 'A file, not a folder.' };
    return { kind: facts.isGitRepo ? 'local-repo' : 'local-folder', path, name };
  }
  if (!facts.parentExists) return { kind: 'invalid', reason: 'Its parent folder doesn’t exist.' };
  return { kind: 'new-folder', path, name };
}

/**
 * Classify the dialog's input. `facts` answer a path input (ignored unless
 * they answer this exact input); a URL needs none.
 */
export function classifySource(raw: string, facts: PathFacts | null): Source {
  const s = raw.trim();
  if (!s) return { kind: 'empty' };
  if (isPathInput(s)) {
    return facts && facts.input === s ? classifyPath(facts) : { kind: 'checking' };
  }
  if (/\s/.test(s)) return { kind: 'invalid', reason: 'Type a folder path or a git URL.' };
  return (
    classifyRemote(s) ?? {
      kind: 'invalid',
      reason: s.startsWith('.')
        ? 'Use a full path, from / or ~.'
        : 'Type a folder path or a git URL.',
    }
  );
}

/** Where a clone goes by default: the folder most projects already sit in, else `home`. */
export function usualProjectsDir(projectPaths: string[], home: string): string {
  const counts = new Map<string, number>();
  for (const p of projectPaths) {
    const parent = p.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
    if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best = home;
  let max = 0;
  for (const [dir, n] of counts) {
    if (n > max) [best, max] = [dir, n];
  }
  return best;
}
