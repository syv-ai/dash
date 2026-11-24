import type {
  Definition,
  DefinitionLink,
  Location,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol';

/*
 * The LSP-shaped decisions of the client, kept free of Monaco and the DOM so
 * they are tested as plain data.
 */

/** The worktree holding `fsPath`: the deepest of `roots` it sits under (a
 *  worktree can live inside its project's folder), or null. */
export function worktreeFor(fsPath: string, roots: Iterable<string>): string | null {
  let best: string | null = null;
  for (const raw of roots) {
    const root = raw.replace(/\/+$/, '');
    if (!root || !fsPath.startsWith(`${root}/`)) continue;
    if (!best || root.length > best.length) best = root;
  }
  return best;
}

/** A result computed on `version` is stale once the model has moved past it.
 *  Versions are Monaco's `getVersionId()`, which is what the client sends. */
export function isStale(version: number, modelVersion: number): boolean {
  return version < modelVersion;
}

/** Where a definition-like result points: each target's uri and the range to
 *  reveal (a link's selection range, the name rather than the whole body). */
export function targetLocations(
  result: Definition | DefinitionLink[] | null | undefined,
): Location[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((l) =>
    'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange } : l,
  );
}

export interface TextEditsByUri {
  edits: Map<string, TextEdit[]>;
  /** The edit also creates, renames or deletes files, which the client can't apply. */
  fileOperations: boolean;
}

/** A WorkspaceEdit's text edits per document, from either of its shapes. */
export function textEditsByUri(edit: WorkspaceEdit | null | undefined): TextEditsByUri {
  const edits = new Map<string, TextEdit[]>();
  let fileOperations = false;
  const add = (uri: string, list: TextEdit[]) =>
    edits.set(uri, [...(edits.get(uri) ?? []), ...list]);
  if (edit?.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('textDocument' in change) add(change.textDocument.uri, change.edits as TextEdit[]);
      else fileOperations = true;
    }
  } else if (edit?.changes) {
    for (const [uri, list] of Object.entries(edit.changes)) add(uri, list);
  }
  return { edits, fileOperations };
}
