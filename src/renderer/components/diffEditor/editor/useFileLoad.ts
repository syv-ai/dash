import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcErrorCode } from '../../../../shared/types';
import { frozenCommit, type EditorView } from '../types';

export type LoadState =
  | { kind: 'loading' }
  /** No file selected (e.g. a clean working tree has nothing to auto-pick). */
  | { kind: 'empty' }
  /** `code` IS_DIRECTORY: the path names a folder (a stale tab). */
  | { kind: 'error'; message: string; code?: IpcErrorCode }
  | {
      kind: 'loaded';
      /** Monotonic id, bumped once per completed read. Consumers that must
       *  reset their buffers on a *fresh load* key off this instead of the
       *  state object's identity — in-place patches (save updating mtime/size)
       *  create a new object but keep the same loadId. */
      loadId: number;
      /** The file this load read: for one render after `filePath` changes,
       *  the state still holds the previous file's load. */
      filePath: string;
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
  /** Read the file again (reload from disk). */
  reload(): void;
} {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const loadSeq = useRef(0);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!filePath) {
        setState({ kind: 'empty' });
        return;
      }
      setState({ kind: 'loading' });
      if (view.kind === 'working' || (view.kind === 'pr' && view.live)) {
        // The working file on disk, against HEAD or the index, or against a
        // PR's base when the checkout is at its head (a live PR view).
        const resp =
          view.kind === 'working'
            ? await window.electronAPI.editorReadWorking({ cwd, filePath, ref: view.ref })
            : await window.electronAPI.editorReadAgainstBase({ cwd, filePath, base: view.base });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({
            kind: 'error',
            message: resp.error ?? 'Failed to load file',
            code: resp.code,
          });
          return;
        }
        const modifiedPresent = resp.data.workingContent !== null;
        const initial = resp.data.workingContent ?? '';
        setState({
          kind: 'loaded',
          loadId: ++loadSeq.current,
          filePath,
          originalContent: resp.data.originalContent,
          modifiedContent: initial,
          mtimeMs: resp.data.mtimeMs,
          sizeBytes: resp.data.sizeBytes,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent,
        });
      } else {
        const frozen = frozenCommit(view)!;
        const resp = await window.electronAPI.editorReadCommit({
          cwd,
          filePath,
          hash: frozen.hash,
          base: frozen.base,
        });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({
            kind: 'error',
            message: resp.error ?? 'Failed to load file',
            code: resp.code,
          });
          return;
        }
        setState({
          kind: 'loaded',
          loadId: ++loadSeq.current,
          filePath,
          originalContent: resp.data.originalContent,
          modifiedContent: resp.data.modifiedContent,
          mtimeMs: 0,
          sizeBytes: 0,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent: true,
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, view, reloads]);

  return { state, reload };
}
