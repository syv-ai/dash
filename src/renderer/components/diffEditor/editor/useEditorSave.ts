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

export function useEditorSave(args: Args): SaveApi {
  const [saving, setSaving] = useState(false);
  const [savedPill, setSavedPill] = useState(false);
  const [stale, setStale] = useState<StaleInfo | null>(null);

  const save = useCallback(async () => {
    if (args.isCommitView || args.state.kind !== 'loaded') return;
    if (args.draft === args.loadedBuffer) return;
    setSaving(true);
    try {
      const resp = await window.electronAPI.editorWriteWorking({
        cwd: args.cwd,
        filePath: args.filePath,
        content: args.draft,
        expectedMtimeMs: args.state.mtimeMs,
        expectedSizeBytes: args.state.sizeBytes,
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
      args.setLoadedBuffer(args.draft);
      args.patchLoadedState({ mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes });
      setStale(null);
      setSavedPill(true);
      window.setTimeout(() => setSavedPill(false), 1000);
    } finally {
      setSaving(false);
    }
  }, [args]);

  const reloadFromDisk = useCallback(async () => {
    if (args.isCommitView) return;
    if (args.draft !== args.loadedBuffer) {
      if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    }
    setStale(null);
    const resp = await window.electronAPI.editorReadWorking({
      cwd: args.cwd,
      filePath: args.filePath,
      ref: args.workingRef,
    });
    if (!resp.success || !resp.data) return;
    const modifiedPresent = resp.data.workingContent !== null;
    const initial = resp.data.workingContent ?? '';
    args.patchLoadedState({
      originalContent: resp.data.originalContent,
      modifiedContent: initial,
      mtimeMs: resp.data.mtimeMs,
      sizeBytes: resp.data.sizeBytes,
      isBinary: resp.data.isBinary,
      isLargeFile: resp.data.isLargeFile,
      language: resp.data.language,
      modifiedPresent,
    });
    args.setLoadedBuffer(initial);
    args.setDraft(initial);
  }, [args]);

  const overwrite = useCallback(async () => {
    if (!stale || args.state.kind !== 'loaded') return;
    args.patchLoadedState({
      mtimeMs: stale.currentMtimeMs,
      sizeBytes: stale.currentSizeBytes,
    });
    setStale(null);
    setTimeout(() => void save(), 0);
  }, [stale, save, args]);

  return { saving, savedPill, stale, setStale, save, overwrite, reloadFromDisk };
}
