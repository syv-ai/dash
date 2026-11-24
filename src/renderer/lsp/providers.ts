import type { IDisposable, editor as monacoEditor, languages, Position } from 'monaco-editor';
import type * as lsp from 'vscode-languageserver-protocol';
import {
  fromCompletionContext,
  fromPosition,
  fromSignatureHelpContext,
  toCompletionItem,
  toCompletionList,
  toHover,
  toRange,
  toSignatureHelp,
} from 'monaco-languageserver-types';
import { monaco } from '../monaco-workers';
import { lspRequest } from './requests';
import type { SyncedDocument } from './documentSync';
import { targetLocations, textEditsByUri } from './protocol';
import { ensureEditModels, ensurePeekModels } from './targetModels';

/*
 * Monaco's language features, answered by the language servers. Registered
 * once per Monaco language id (Monaco maps .tsx to typescript and .jsx to
 * javascript); every provider answers nothing for a model no server serves,
 * which includes the `git:` snapshot side of a diff.
 */

type Model = monacoEditor.ITextModel;

/** Characters that open completion, per language. The servers announce their
 *  own in `initialize`, which stays in main; these are the usual sets. */
const COMPLETION_TRIGGERS: Record<string, string[]> = {
  typescript: ['.', '"', "'", '`', '/', '@', '<', '#'],
  javascript: ['.', '"', "'", '`', '/', '@', '<', '#'],
  python: ['.', '[', '"', "'"],
  go: ['.'],
  rust: ['.', ':', "'"],
};

export const LSP_LANGUAGES = Object.keys(COMPLETION_TRIGGERS);

const position = (doc: SyncedDocument, pos: Position) => ({
  textDocument: { uri: doc.uri },
  position: fromPosition(pos),
});

/** The LSP item each Monaco completion came from, and its model: what
 *  `completionItem/resolve` sends. */
const completionOrigins = new WeakMap<
  languages.CompletionItem,
  { model: Model; item: lsp.CompletionItem }
>();

function completionProvider(language: string): languages.CompletionItemProvider {
  return {
    triggerCharacters: COMPLETION_TRIGGERS[language],
    async provideCompletionItems(model, pos, context, token) {
      const answer = await lspRequest<lsp.CompletionList | lsp.CompletionItem[] | null>(
        model,
        'textDocument/completion',
        (doc) => ({ ...position(doc, pos), context: fromCompletionContext(context) }),
        token,
      );
      const result = answer?.result;
      if (!result) return undefined;
      const list: lsp.CompletionList = Array.isArray(result)
        ? { isIncomplete: false, items: result }
        : result;
      const word = model.getWordUntilPosition(pos);
      const range = new monaco.Range(
        pos.lineNumber,
        word.startColumn,
        pos.lineNumber,
        word.endColumn,
      );
      const converted = toCompletionList(list, { range });
      converted.suggestions.forEach((s, i) =>
        completionOrigins.set(s, { model, item: list.items[i]! }),
      );
      return converted;
    },
    async resolveCompletionItem(item, token) {
      const origin = completionOrigins.get(item);
      if (!origin || origin.model.isDisposed()) return item;
      const resolved = (
        await lspRequest<lsp.CompletionItem | null>(
          origin.model,
          'completionItem/resolve',
          () => origin.item,
          token,
        )
      )?.result;
      if (!resolved) return item;
      const more = toCompletionItem(resolved, { range: item.range });
      return {
        ...item,
        detail: more.detail ?? item.detail,
        documentation: more.documentation ?? item.documentation,
        additionalTextEdits: more.additionalTextEdits ?? item.additionalTextEdits,
      };
    },
  };
}

const hoverProvider: languages.HoverProvider = {
  async provideHover(model, pos, token) {
    const answer = await lspRequest<lsp.Hover | null>(
      model,
      'textDocument/hover',
      (doc) => position(doc, pos),
      token,
    );
    return answer?.result ? toHover(answer.result) : undefined;
  },
};

const signatureHelpProvider: languages.SignatureHelpProvider = {
  signatureHelpTriggerCharacters: ['(', ',', '<'],
  signatureHelpRetriggerCharacters: [')'],
  async provideSignatureHelp(model, pos, token, context) {
    const result = (
      await lspRequest<lsp.SignatureHelp | null>(
        model,
        'textDocument/signatureHelp',
        (doc) => ({ ...position(doc, pos), context: fromSignatureHelpContext(context) }),
        token,
      )
    )?.result;
    if (!result || result.signatures.length === 0) return undefined;
    return { value: toSignatureHelp(result), dispose: () => {} };
  },
};

/**
 * Locations as Monaco wants them. One target opens through the editor opener
 * (a tab); several show in a peek view, which needs their files as models, so
 * they are loaded first and targets that can't be (outside the worktree) drop.
 */
async function toMonacoLocations(
  answer: { result: lsp.Definition | lsp.DefinitionLink[] | null; doc: SyncedDocument } | undefined,
): Promise<languages.Location[] | undefined> {
  const targets = targetLocations(answer?.result);
  if (!answer || targets.length === 0) return undefined;
  let shown = targets;
  if (targets.length > 1) {
    const ready = await ensurePeekModels(
      answer.doc.worktree,
      targets.map((t) => t.uri),
    );
    shown = targets.filter((t) => ready.has(t.uri));
  }
  return shown.map((t) => ({ uri: monaco.Uri.parse(t.uri), range: toRange(t.range) }));
}

const definitionProvider: languages.DefinitionProvider = {
  async provideDefinition(model, pos, token) {
    return toMonacoLocations(
      await lspRequest<lsp.Definition | lsp.DefinitionLink[] | null>(
        model,
        'textDocument/definition',
        (doc) => position(doc, pos),
        token,
      ),
    );
  },
};

const referenceProvider: languages.ReferenceProvider = {
  async provideReferences(model, pos, context, token) {
    return toMonacoLocations(
      await lspRequest<lsp.Location[] | null>(
        model,
        'textDocument/references',
        (doc) => ({ ...position(doc, pos), context }),
        token,
      ),
    );
  },
};

const renameProvider: languages.RenameProvider = {
  async resolveRenameLocation(model, pos, token) {
    type Prepared = lsp.PrepareRenameResult | null;
    const answer = await lspRequest<Prepared>(
      model,
      'textDocument/prepareRename',
      (doc) => position(doc, pos),
      token,
    );
    // No answer (no server, or it doesn't prepare): Monaco renames the word.
    if (!answer) return undefined;
    const result = answer.result;
    const word = model.getWordAtPosition(pos);
    const wordRange = new monaco.Range(
      pos.lineNumber,
      word?.startColumn ?? pos.column,
      pos.lineNumber,
      word?.endColumn ?? pos.column,
    );
    if (result === null) {
      return { range: wordRange, text: word?.word ?? '', rejectReason: "This can't be renamed." };
    }
    if ('defaultBehavior' in result) return undefined;
    const range = toRange('range' in result ? result.range : result);
    const text = 'placeholder' in result ? result.placeholder : model.getValueInRange(range);
    return { range, text };
  },

  async provideRenameEdits(model, pos, newName, token) {
    const answer = await lspRequest<lsp.WorkspaceEdit | null>(
      model,
      'textDocument/rename',
      (doc) => ({ ...position(doc, pos), newName }),
      token,
    );
    if (!answer?.result) return undefined;
    const { edits, fileOperations } = textEditsByUri(answer.result);
    const reject = (rejectReason: string) => ({ edits: [], rejectReason });
    if (fileOperations) return reject('This rename also moves files, which Dash cannot apply.');
    // Files not open yet are loaded (and opened in background tabs) first:
    // their edits stay unsaved until the user saves them.
    if (!(await ensureEditModels(answer.doc.worktree, [...edits.keys()]))) {
      return reject("This rename touches files outside the task's worktree.");
    }
    return {
      edits: [...edits].flatMap(([uri, list]) =>
        list.map((e) => ({
          resource: monaco.Uri.parse(uri),
          textEdit: { range: toRange(e.range), text: e.newText },
          versionId: undefined,
        })),
      ),
    };
  },
};

/** Register every provider for every served language. */
export function registerProviders(): IDisposable {
  const subs: IDisposable[] = [];
  for (const language of LSP_LANGUAGES) {
    const l = monaco.languages;
    subs.push(
      l.registerCompletionItemProvider(language, completionProvider(language)),
      l.registerHoverProvider(language, hoverProvider),
      l.registerSignatureHelpProvider(language, signatureHelpProvider),
      l.registerDefinitionProvider(language, definitionProvider),
      l.registerReferenceProvider(language, referenceProvider),
      l.registerRenameProvider(language, renameProvider),
    );
  }
  return { dispose: () => subs.forEach((s) => s.dispose()) };
}
