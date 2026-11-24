import { useCallback, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { diskStamp, isDirty, markSaved, type DiskStamp } from '../models';
import { confirm } from '../../ui/ConfirmHost';

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
  /** `expected` overrides the disk stamp sent as the optimistic-lock guard
   *  (overwrite passes the on-disk values it just learned). */
  save(expected?: DiskStamp): Promise<void>;
  overwrite(): Promise<void>;
  reloadFromDisk(): Promise<void>;
}

interface Args {
  cwd: string;
  filePath: string;
  /** The working file's shared model; null when the pane shows a frozen view. */
  model: monacoEditor.ITextModel | null;
  /** Read the file again, taking the disk's text over the buffer. */
  reload(): void;
}

/** Saves the working file's model to disk, guarded by the stamp of its last
 *  load or save. The dirty flag and stamp live with the model (models.ts), so
 *  a save from one group is seen by the other. */
export function useEditorSave({ cwd, filePath, model, reload }: Args): SaveApi {
  const [saving, setSaving] = useState(false);
  const [savedPill, setSavedPill] = useState(false);
  const [stale, setStale] = useState<StaleInfo | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(
    async (expected?: DiskStamp) => {
      if (!model || !isDirty(model.uri.toString())) return;
      const stamp = expected ?? diskStamp(model);
      if (!stamp) return;
      // What is written is this version: edits typed during the write stay dirty.
      const versionId = model.getAlternativeVersionId();
      const content = model.getValue();
      setSaving(true);
      setSaveError(null);
      try {
        const resp = await window.electronAPI.editorWriteWorking({
          cwd,
          filePath,
          content,
          expectedMtimeMs: stamp.mtimeMs,
          expectedSizeBytes: stamp.sizeBytes,
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
        if (!model.isDisposed()) {
          markSaved(
            model,
            { mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes },
            versionId,
          );
        }
        setStale(null);
        setSavedPill(true);
        window.setTimeout(() => setSavedPill(false), 1000);
      } finally {
        setSaving(false);
      }
    },
    [cwd, filePath, model],
  );

  const reloadFromDisk = useCallback(async () => {
    if (model && isDirty(model.uri.toString())) {
      const discard = await confirm({
        message: 'Discard unsaved changes and reload from disk?',
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (!discard) return;
    }
    setStale(null);
    setSaveError(null);
    reload();
  }, [model, reload]);

  const overwrite = useCallback(async () => {
    if (!stale) return;
    const expected = { mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes };
    setStale(null);
    await save(expected);
  }, [stale, save]);

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
