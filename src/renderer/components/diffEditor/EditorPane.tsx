import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from 'xterm';
import { X, FileText, WrapText } from 'lucide-react';
import { defineMonacoThemeFromTerminal, themeNameFor } from './monacoTheme';
import type { EditorView } from './types';
import '../../monaco-workers';

const WORDWRAP_KEY = 'diffEditor.wordWrap';

interface EditorPaneProps {
  cwd: string;
  filePath: string;
  view: EditorView;
  activeTaskId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onClose: () => void;
  /** Confirm-before-close (e.g. if the host has unsaved changes elsewhere). */
  guardClose?: () => boolean;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      originalContent: string;
      modifiedContent: string; // initial buffer for the modified side
      mtimeMs: number; // 0 in commit view
      sizeBytes: number; // 0 in commit view
      isBinary: boolean;
      isLargeFile: boolean;
      language: string;
      modifiedPresent: boolean; // false when file is deleted on disk (working view)
    };

interface Comment {
  id: string;
  decorationId: string;
  comment: string;
}

interface StaleInfo {
  currentMtimeMs: number;
  currentSizeBytes: number;
}

export function EditorPane({
  cwd,
  filePath,
  view,
  activeTaskId,
  terminalTheme,
  isDark,
  onClose,
}: EditorPaneProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [draft, setDraft] = useState<string>('');
  const [loadedBuffer, setLoadedBuffer] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedPill, setSavedPill] = useState(false);
  const [stale, setStale] = useState<StaleInfo | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(
    () => localStorage.getItem(WORDWRAP_KEY) === 'on',
  );

  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const commentDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const selectionDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const dragRef = useRef<{ startLine: number } | null>(null);
  const saveCmdRef = useRef<(() => void) | null>(null);

  const themeName = themeNameFor(isDark);
  const isCommitView = view.kind === 'commit';
  const dirty = !isCommitView && draft !== loadedBuffer;
  const editable =
    !isCommitView &&
    state.kind === 'loaded' &&
    !state.isBinary &&
    !state.isLargeFile &&
    state.modifiedPresent;

  // ── Load file when key changes ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Empty path → no file yet. The orchestrator will fill it in once the
      // file tree loads. Stay on the loading skeleton until then.
      if (!filePath) {
        setState({ kind: 'loading' });
        return;
      }
      setState({ kind: 'loading' });
      if (view.kind === 'working') {
        const resp = await window.electronAPI.editorReadWorking({
          cwd,
          filePath,
          ref: view.ref,
        });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({ kind: 'error', message: resp.error ?? 'Failed to load file' });
          return;
        }
        const modifiedPresent = resp.data.workingContent !== null;
        const initial = resp.data.workingContent ?? '';
        setState({
          kind: 'loaded',
          originalContent: resp.data.originalContent,
          modifiedContent: initial,
          mtimeMs: resp.data.mtimeMs,
          sizeBytes: resp.data.sizeBytes,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent,
        });
        setLoadedBuffer(initial);
        setDraft(initial);
      } else {
        const resp = await window.electronAPI.editorReadCommit({
          cwd,
          filePath,
          hash: view.hash,
        });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({ kind: 'error', message: resp.error ?? 'Failed to load file' });
          return;
        }
        setState({
          kind: 'loaded',
          originalContent: resp.data.originalContent,
          modifiedContent: resp.data.modifiedContent,
          mtimeMs: 0,
          sizeBytes: 0,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent: true,
        });
        setLoadedBuffer(resp.data.modifiedContent);
        setDraft(resp.data.modifiedContent);
      }
      setComments([]);
      setPendingRange(null);
      setStale(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, view]);

  // ── Re-apply Monaco theme on terminal-theme change ──────
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineMonacoThemeFromTerminal(monaco, themeName, isDark, terminalTheme);
    monaco.editor.setTheme(themeName);
  }, [themeName, isDark, terminalTheme]);

  useEffect(() => {
    localStorage.setItem(WORDWRAP_KEY, wordWrap ? 'on' : 'off');
  }, [wordWrap]);

  // ── Save flow (working view only) ───────────────────────
  const save = useCallback(async () => {
    if (isCommitView || state.kind !== 'loaded') return;
    if (draft === loadedBuffer) return;
    setSaving(true);
    try {
      const resp = await window.electronAPI.editorWriteWorking({
        cwd,
        filePath,
        content: draft,
        expectedMtimeMs: state.mtimeMs,
        expectedSizeBytes: state.sizeBytes,
      });
      if (!resp.success || !resp.data) {
        setStale({ currentMtimeMs: 0, currentSizeBytes: 0 });
        return;
      }
      if (resp.data.ok === false) {
        setStale({
          currentMtimeMs: resp.data.currentMtimeMs,
          currentSizeBytes: resp.data.currentSizeBytes,
        });
        return;
      }
      setLoadedBuffer(draft);
      setState({ ...state, mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes });
      setStale(null);
      setSavedPill(true);
      window.setTimeout(() => setSavedPill(false), 1000);
    } finally {
      setSaving(false);
    }
  }, [cwd, filePath, draft, loadedBuffer, state, isCommitView]);

  useEffect(() => {
    saveCmdRef.current = () => void save();
  });

  const reloadFromDisk = useCallback(async () => {
    if (isCommitView || view.kind !== 'working') return;
    if (draft !== loadedBuffer) {
      if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    }
    setStale(null);
    const resp = await window.electronAPI.editorReadWorking({
      cwd,
      filePath,
      ref: view.ref,
    });
    if (!resp.success || !resp.data) return;
    const modifiedPresent = resp.data.workingContent !== null;
    const initial = resp.data.workingContent ?? '';
    setState({
      kind: 'loaded',
      originalContent: resp.data.originalContent,
      modifiedContent: initial,
      mtimeMs: resp.data.mtimeMs,
      sizeBytes: resp.data.sizeBytes,
      isBinary: resp.data.isBinary,
      isLargeFile: resp.data.isLargeFile,
      language: resp.data.language,
      modifiedPresent,
    });
    setLoadedBuffer(initial);
    setDraft(initial);
  }, [cwd, filePath, view, draft, loadedBuffer, isCommitView]);

  const overwrite = useCallback(async () => {
    if (!stale || state.kind !== 'loaded') return;
    setState({ ...state, mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes });
    setStale(null);
    setTimeout(() => void save(), 0);
  }, [stale, save, state]);

  // ── Editor mount + selection mechanic ──────────────────
  function handleMount(
    editor: monacoEditor.IStandaloneDiffEditor,
    monaco: typeof import('monaco-editor'),
  ) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    defineMonacoThemeFromTerminal(monaco, themeName, isDark, terminalTheme);
    monaco.editor.setTheme(themeName);

    const modified = editor.getModifiedEditor();

    modified.onDidChangeModelContent(() => {
      if (!isCommitView) setDraft(modified.getValue());
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCmdRef.current?.();
    });

    modified.onMouseDown((e) => {
      const t = e.target;
      if (
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      )
        return;
      const line = t.position?.lineNumber;
      if (!line) return;
      dragRef.current = { startLine: line };
      setPendingRange({ start: line, end: line });
    });
    modified.onMouseMove((e) => {
      if (!dragRef.current) return;
      const line = e.target.position?.lineNumber;
      if (!line) return;
      const start = Math.min(dragRef.current.startLine, line);
      const end = Math.max(dragRef.current.startLine, line);
      setPendingRange({ start, end });
    });
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mouseup', onUp);
    editor.onDidDispose(() => window.removeEventListener('mouseup', onUp));
  }

  // Selection highlight
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!selectionDecorations.current) {
      selectionDecorations.current = editor.createDecorationsCollection();
    }
    if (!pendingRange) {
      selectionDecorations.current.clear();
      return;
    }
    selectionDecorations.current.set([
      {
        range: new monaco.Range(pendingRange.start, 1, pendingRange.end, 1),
        options: { isWholeLine: true, className: 'monaco-select-line' },
      },
    ]);
  }, [pendingRange]);

  // Comment highlights
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    if (!commentDecorations.current) {
      commentDecorations.current = editor.createDecorationsCollection();
    }
    const decos: monacoEditor.IModelDeltaDecoration[] = comments.flatMap((c) => {
      const range = model.getDecorationRange(c.decorationId);
      if (!range) return [];
      return [
        {
          range,
          options: {
            isWholeLine: true,
            className: 'monaco-comment-line',
            glyphMarginClassName: 'monaco-comment-glyph',
          },
        },
      ];
    });
    commentDecorations.current.set(decos);
  }, [comments]);

  function addComment(text: string) {
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco || !pendingRange) return;
    const model = editor.getModel();
    if (!model) return;
    const ids = model.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(pendingRange.start, 1, pendingRange.end, 1),
          options: { isWholeLine: true, stickiness: 1 },
        },
      ],
    );
    const decorationId = ids[0];
    setComments((prev) => [...prev, { id: crypto.randomUUID(), decorationId, comment: text }]);
    setPendingRange(null);
  }

  function buildPromptAndSend() {
    if (!activeTaskId || comments.length === 0) return;
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    const lang = state.kind === 'loaded' ? state.language : '';
    const sections = comments.flatMap((c) => {
      const range = model.getDecorationRange(c.decorationId);
      if (!range) return [];
      const startLine = range.startLineNumber;
      const endLine = range.endLineNumber;
      const lineRange =
        startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
      const code = model.getValueInRange(
        new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
      );
      return [`${lineRange}:\n\`\`\`${lang}\n${code}\n\`\`\`\n${c.comment}`];
    });
    const prompt = `Comments on file ${filePath}:\n\n${sections.join('\n\n---\n\n')}`;
    void import('../../terminal/SessionRegistry').then(({ sessionRegistry }) => {
      const session = sessionRegistry.get(activeTaskId);
      if (session) session.writeInput(prompt);
    });
    onClose();
  }

  function handleClose() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <div
        className="flex items-center justify-between px-3 h-7 border-b border-white/[0.06] flex-shrink-0"
        style={{ background: terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3') }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <FileText
            size={14}
            className="text-muted-foreground/50 flex-shrink-0"
            strokeWidth={1.8}
          />
          <span className="text-[13px] font-medium text-foreground truncate">{filePath}</span>
          {isCommitView && (
            <span className="text-[11px] tabular-nums text-muted-foreground/50 font-mono">
              {view.hash.slice(0, 7)}
            </span>
          )}
          {editable && (
            <span
              className={`text-[11px] tabular-nums ${
                dirty ? 'text-primary' : 'text-muted-foreground/40'
              }`}
            >
              {dirty ? '● Unsaved' : '○ Clean'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pendingRange && (
            <CommentInputBar onSubmit={addComment} onCancel={() => setPendingRange(null)} />
          )}
          {comments.length > 0 && (
            <button
              onClick={buildPromptAndSend}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all duration-150"
            >
              Add {comments.length} comment{comments.length !== 1 ? 's' : ''} to prompt
            </button>
          )}
          <button
            onClick={() => setWordWrap((w) => !w)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            className={`p-1.5 rounded-md transition-colors ${
              wordWrap
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <WrapText size={14} strokeWidth={1.8} />
          </button>
          {editable && (
            <>
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {savedPill && (
                <span className="text-[11px] text-primary/80 animate-fade-in">Saved</span>
              )}
            </>
          )}
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {stale && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-amber-500/40 bg-amber-500/10 text-[11px] flex-shrink-0">
          <span className="text-amber-700 dark:text-amber-300">
            This file changed on disk since you opened it.
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => void overwrite()}
              className="px-2 py-1 rounded-md text-[11px] bg-destructive/15 text-destructive hover:bg-destructive/25"
            >
              Overwrite
            </button>
            <button
              onClick={() => void reloadFromDisk()}
              className="px-2 py-1 rounded-md text-[11px] bg-accent hover:bg-accent/80"
            >
              Reload from disk
            </button>
            <button
              onClick={() => setStale(null)}
              className="px-2 py-1 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-[13px] text-muted-foreground/50">Loading…</span>
            </div>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-destructive">{state.message}</span>
          </div>
        )}
        {state.kind === 'loaded' && state.isBinary && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-muted-foreground/40">
              Binary file — cannot display diff
            </span>
          </div>
        )}
        {state.kind === 'loaded' && state.isLargeFile && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-muted-foreground/40">
              File too large to preview here (&gt;5 MB).
            </span>
          </div>
        )}
        {state.kind === 'loaded' && !state.isBinary && !state.isLargeFile && (
          <MonacoDiffEditor
            original={state.originalContent}
            modified={isCommitView ? state.modifiedContent : draft}
            language={state.language || undefined}
            theme={themeName}
            options={{
              originalEditable: false,
              readOnly: !editable,
              renderSideBySide: false,
              minimap: { enabled: false },
              automaticLayout: true,
              fontSize: 12,
              lineNumbers: 'on',
              glyphMargin: true,
              scrollBeyondLastLine: false,
              wordWrap: wordWrap ? 'on' : 'off',
              overviewRulerBorder: false,
            }}
            onMount={handleMount}
          />
        )}
      </div>
    </div>
  );
}

// ── Inline comment input ───────────────────────────────────

function CommentInputBar({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim()) onSubmit(text.trim());
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Comment…"
        className="px-2 py-1 text-[11px] rounded-md bg-background border border-border/60 focus:outline-none focus:border-primary/40 w-48"
      />
      <button
        type="button"
        onClick={() => text.trim() && onSubmit(text.trim())}
        className="px-2 py-1 text-[11px] rounded-md bg-primary/15 text-primary hover:bg-primary/25"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
      >
        Cancel
      </button>
    </div>
  );
}
