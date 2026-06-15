export interface PromptComment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface BuildPromptArgs {
  ids: ReadonlyArray<string>;
  byFile: Record<string, PromptComment[]>;
  currentFilePath: string;
  /** Optional current-file enrichment: language + a per-id code excerpt
   *  (already resolved against the live model by the caller). */
  currentFile?: {
    language: string;
    codeForId: (comment: PromptComment) => string;
  };
}

/** Pure: turn a set of comment ids into the `path:line:` prompt body. Current
 *  file sorts first; current-file comments may carry a fenced code excerpt. */
export function buildCommentPrompt(args: BuildPromptArgs): string | null {
  const { ids, byFile, currentFilePath, currentFile } = args;
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
      const header = `${path}:${lineRef}:`;
      const code = isCurrent && currentFile ? currentFile.codeForId(c) : '';
      const lang = currentFile?.language ?? '';
      sections.push(
        code ? `${header}\n\`\`\`${lang}\n${code}\n\`\`\`\n${c.text}` : `${header}\n${c.text}`,
      );
    }
  }
  return `Comments:\n\n${sections.join('\n\n')}`;
}
