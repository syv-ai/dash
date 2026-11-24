import { forgeCommitUrl, parseForgeRepo } from '@shared/urls';
import type { CommitLinks } from '@shared/types';
import { GitService } from './GitService';
import { GithubService } from './GithubService';

const NONE: CommitLinks = { commitUrl: null, authorUrl: null };

/** Pushed commits' links by `cwd` + sha. A pushed commit's links never
 *  change; an unpushed one is asked again (it may be pushed since). */
const cache = new Map<string, Promise<CommitLinks>>();

/**
 * Where a commit lives on its forge: its page, only once a remote branch
 * holds it, and its author's profile where the forge knows it (GitHub, which
 * matched the commit's email to a user; else none — never guessed from the
 * email).
 */
export function commitLinks(cwd: string, sha: string): Promise<CommitLinks> {
  const key = `${cwd}\0${sha}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = resolve(cwd, sha).then((links) => {
    if (!links.commitUrl) cache.delete(key);
    return links;
  });
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

async function resolve(cwd: string, sha: string): Promise<CommitLinks> {
  const repo = parseForgeRepo(await GitService.getOriginUrl(cwd));
  if (!repo || !(await GitService.isOnRemote(cwd, sha))) return NONE;
  const authorUrl =
    repo.kind === 'github' ? await GithubService.commitAuthorUrl(cwd, sha).catch(() => null) : null;
  return { commitUrl: forgeCommitUrl(repo, sha), authorUrl };
}
