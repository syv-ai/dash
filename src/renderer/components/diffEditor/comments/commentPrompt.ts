import { parsePrScope } from '../../../../shared/prScope';
import type { DiffCommentKind } from '../../../../shared/types';

export interface PromptComment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  /** Diff state the comment is anchored to ('live', 'commit:<hash>' or 'pr:<provider>:<n>'). */
  viewScope: string;
  kind?: DiffCommentKind;
}

export interface BuildPromptArgs {
  ids: ReadonlyArray<string>;
  byFile: Record<string, PromptComment[]>;
  currentFilePath: string;
  /** Scope of the open view. Code enrichment is only valid for current-file
   *  comments whose scope matches it (the live model holds that content). */
  currentScope: string;
  /** Optional current-file enrichment: language + a per-id code excerpt
   *  (already resolved against the live model by the caller). */
  currentFile?: {
    language: string;
    codeForId: (comment: PromptComment) => string;
  };
}

/** ` (commit <short>)` suffix for a commit-scoped comment so the agent knows
 *  the line ref is from that commit, not the working tree; ` (PR #n …)` for a
 *  PR's, saying whether it's a review comment that goes to the PR. Empty for live. */
function scopeSuffix(c: Pick<PromptComment, 'viewScope' | 'kind'>): string {
  const pr = parsePrScope(c.viewScope);
  if (pr) return ` (PR #${pr.number}${c.kind === 'comment' ? ' review comment' : ''})`;
  return c.viewScope.startsWith('commit:') ? ` (commit ${c.viewScope.slice(7, 14)})` : '';
}

/** Pure: turn a set of comment ids into the `path:line:` prompt body. Current
 *  file sorts first; current-file comments may carry a fenced code excerpt. */
export function buildCommentPrompt(args: BuildPromptArgs): string | null {
  const { ids, byFile, currentFilePath, currentScope, currentFile } = args;
  if (ids.length === 0) return null;
  const idSet = new Set(ids);

  const fileGroups = Object.entries(byFile)
    .map(([path, list]) => [path, list.filter((c) => idSet.has(c.id))] as const)
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => {
      if (a === currentFilePath) return -1;
      if (b === currentFilePath) return 1;
      return a.localeCompare(b);
    });
  if (fileGroups.length === 0) return null;

  const sections: string[] = [];
  for (const [path, list] of fileGroups) {
    const isCurrent = path === currentFilePath;
    for (const c of list) {
      const lineRef = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
      const header = `${path}:${lineRef}:${scopeSuffix(c)}`;
      // Only the open view's content lives in the model, so a code excerpt is
      // trustworthy only for current-file comments of the current scope.
      const canEnrich = isCurrent && !!currentFile && c.viewScope === currentScope;
      const code = canEnrich ? currentFile!.codeForId(c) : '';
      const lang = currentFile?.language ?? '';
      sections.push(
        code ? `${header}\n\`\`\`${lang}\n${code}\n\`\`\`\n${c.text}` : `${header}\n${c.text}`,
      );
    }
  }
  return `Comments:\n\n${sections.join('\n\n')}`;
}
