import { useCallback, useState } from 'react';
import type { WorkingRef } from '@shared/types';
import type { LoadState } from './useFileLoad';

export interface StaleInfo {
  currentMtimeMs: number;
  currentSizeBytes: number;
}

export interface SaveApi {
  saving: boolean;
  savedPill: boolean;
  stale: StaleInfo | null;
  setStale(info: StaleInfo | null): void;
  /** Set when a save fails outright (IPC error, path rejected, write failed) —
   *  distinct from a stale conflict, which is a successful response. */
  saveError: string | null;
  setSaveError(msg: string | null): void;
  /** `expected` overrides the mtime/size sent as the optimistic-lock guard.
   *  Callers that just learned the on-disk values (overwrite) pass them in
   *  directly rather than relying on a re-render to refresh the closure. */
  save(expected?: { mtimeMs: number; sizeBytes: number }): Promise<void>;
  overwrite(): Promise<void>;
  reloadFromDisk(): Promise<void>;
}

interface Args {
  cwd: string;
  filePath: string;
  /** 'HEAD' or 'index' for working view; ignored in commit view. */
  workingRef: WorkingRef;
  state: LoadState;
  draft: string;
  loadedBuffer: string;
  setLoadedBuffer(s: string): void;
  setDraft(s: string): void;
  /** Caller mutates its own load state when we finish saving (mtime + size
   *  change) and when we reload from disk. */
  patchLoadedState(next: Partial<Extract<LoadState, { kind: 'loaded' }>>): void;
  isCommitView: boolean;
}

export function useEditorSave({
  cwd,
  filePath,
  workingRef,
  state,
  draft,
  loadedBuffer,
  setLoadedBuffer,
  setDraft,
  patchLoadedState,
  isCommitView,
}: Args): SaveApi {
  const [saving, setSaving] = useState(false);
  const [savedPill, setSavedPill] = useState(false);
  const [stale, setStale] = useState<StaleInfo | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(
    async (expected?: { mtimeMs: number; sizeBytes: number }) => {
      if (isCommitView || state.kind !== 'loaded') return;
      if (draft === loadedBuffer) return;
      setSaving(true);
      setSaveError(null);
      try {
        const resp = await window.electronAPI.editorWriteWorking({
          cwd,
          filePath,
          content: draft,
          expectedMtimeMs: expected?.mtimeMs ?? state.mtimeMs,
          expectedSizeBytes: expected?.sizeBytes ?? state.sizeBytes,
        });
        // A genuine failure (path rejected, fs error) comes back as
        // success:false — surface it instead of faking a stale conflict, which
        // would show a phantom "changed on disk" prompt and drop the edit.
        if (!resp.success || !resp.data) {
          setSaveError(resp.error ?? 'Could not save the file.');
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
        patchLoadedState({ mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes });
        setStale(null);
        setSavedPill(true);
        window.setTimeout(() => setSavedPill(false), 1000);
      } finally {
        setSaving(false);
      }
    },
    [cwd, filePath, isCommitView, state, draft, loadedBuffer, setLoadedBuffer, patchLoadedState],
  );

  const reloadFromDisk = useCallback(async () => {
    if (isCommitView) return;
    if (draft !== loadedBuffer) {
      if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    }
    setStale(null);
    setSaveError(null);
    const resp = await window.electronAPI.editorReadWorking({ cwd, filePath, ref: workingRef });
    if (!resp.success || !resp.data) return;
    const modifiedPresent = resp.data.workingContent !== null;
    const initial = resp.data.workingContent ?? '';
    patchLoadedState({
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
  }, [
    cwd,
    filePath,
    workingRef,
    isCommitView,
    draft,
    loadedBuffer,
    setLoadedBuffer,
    setDraft,
    patchLoadedState,
  ]);

  const overwrite = useCallback(async () => {
    if (!stale || state.kind !== 'loaded') return;
    // Hand the just-learned on-disk mtime/size straight to save() as the lock
    // guard. Relying on patchLoadedState → re-render to refresh save()'s closure
    // raced: the save fired with the old expected mtime and no-op'd, needing a
    // second click.
    const expected = { mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes };
    patchLoadedState(expected);
    setStale(null);
    await save(expected);
  }, [stale, save, state, patchLoadedState]);

  return {
    saving,
    savedPill,
    stale,
    setStale,
    saveError,
    setSaveError,
    save,
    overwrite,
    reloadFromDisk,
  };
}
