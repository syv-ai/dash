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
  save(): Promise<void>;
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
      patchLoadedState({ mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes });
      setStale(null);
      setSavedPill(true);
      window.setTimeout(() => setSavedPill(false), 1000);
    } finally {
      setSaving(false);
    }
  }, [cwd, filePath, isCommitView, state, draft, loadedBuffer, setLoadedBuffer, patchLoadedState]);

  const reloadFromDisk = useCallback(async () => {
    if (isCommitView) return;
    if (draft !== loadedBuffer) {
      if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    }
    setStale(null);
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
    patchLoadedState({ mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes });
    setStale(null);
    setTimeout(() => void save(), 0);
  }, [stale, save, state, patchLoadedState]);

  return { saving, savedPill, stale, setStale, save, overwrite, reloadFromDisk };
}
