import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '../types';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      /** Monotonic id, bumped once per completed read. Consumers that must
       *  reset their buffers on a *fresh load* key off this instead of the
       *  state object's identity — in-place patches (save updating mtime/size)
       *  create a new object but keep the same loadId. */
      loadId: number;
      originalContent: string;
      modifiedContent: string;
      mtimeMs: number;
      sizeBytes: number;
      isBinary: boolean;
      isLargeFile: boolean;
      language: string;
      modifiedPresent: boolean;
    };

/** Loads working-tree or commit content for one (cwd, filePath, view).
 *  Cancellation is handled internally; the returned `state` is always for
 *  the most recent set of inputs. The hook does NOT handle decorations or
 *  draft buffers — those are caller concerns. */
export function useFileLoad(
  cwd: string,
  filePath: string,
  view: EditorView,
): {
  state: LoadState;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
} {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const loadSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
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
          loadId: ++loadSeq.current,
          originalContent: resp.data.originalContent,
          modifiedContent: initial,
          mtimeMs: resp.data.mtimeMs,
          sizeBytes: resp.data.sizeBytes,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent,
        });
      } else if (view.kind === 'commit') {
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
          loadId: ++loadSeq.current,
          originalContent: resp.data.originalContent,
          modifiedContent: resp.data.modifiedContent,
          mtimeMs: 0,
          sizeBytes: 0,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent: true,
        });
      } else {
        // view.kind === 'branch'
        const resp = await window.electronAPI.editorReadAgainstBase({
          cwd,
          filePath,
          base: view.base,
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
          loadId: ++loadSeq.current,
          originalContent: resp.data.originalContent,
          modifiedContent: initial,
          mtimeMs: resp.data.mtimeMs,
          sizeBytes: resp.data.sizeBytes,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent,
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, view]);

  return { state, setState };
}
