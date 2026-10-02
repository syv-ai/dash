import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { MemoryEntry, MemoryType, ProjectMemory } from '../../../shared/types';
import {
  canSaveDraft,
  draftHook,
  editMemoryDraft,
  isDraftDirty,
  newMemoryDraft,
  type KnownMemoryType,
  type MemoryDraft,
  type MemoryDraftFields,
} from './memoryView';

type FileStat = { mtimeMs: number; sizeBytes: number };

export interface MemoryDraftApi {
  /** The memory being created or edited, or null while only viewing. */
  draft: MemoryDraft | null;
  saving: boolean;
  /** The file changed on disk since the draft was opened; nothing was written. */
  stale: boolean;
  saveError: string | null;
  /** Start a memory of `type` (the list's current type, when it has one). */
  startNew(type?: KnownMemoryType): void;
  startEdit(entry: MemoryEntry): void;
  change(fields: MemoryDraftFields): void;
  save(): Promise<void>;
  /** Save over the newer file on disk. */
  overwrite(): Promise<void>;
  /** Replace the draft with what is on disk now. */
  reloadFromDisk(): Promise<void>;
  dismissStale(): void;
  dismissError(): void;
  /** Drop the draft, asking first when it has unsaved edits. False if the user kept it. */
  discard(): boolean;
}

interface Args {
  projectPath: string;
  reload: () => Promise<ProjectMemory | null>;
  /** Called with the saved memory's file and type once the list has it. */
  onSaved: (file: string, type: MemoryType) => void;
}

/** Create/edit state for the memory modal, with the diff editor's stale-save flow. */
export function useMemoryDraft({ projectPath, reload, onSaved }: Args): MemoryDraftApi {
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState<FileStat | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const open = useCallback((next: MemoryDraft | null) => {
    setDraft(next);
    setStale(null);
    setSaveError(null);
  }, []);

  const discard = useCallback(() => {
    if (draft && isDraftDirty(draft) && !window.confirm('Discard unsaved changes?')) return false;
    open(null);
    return true;
  }, [draft, open]);

  const save = useCallback(
    async (expected?: FileStat) => {
      if (!draft || !canSaveDraft(draft) || saving) return;
      setSaving(true);
      setSaveError(null);
      try {
        let file: string;
        // What the index line should say, not always what the field holds (see draftHook).
        const fields = { ...draft.fields, hook: draftHook(draft) };
        if (!draft.target) {
          const res = await window.electronAPI.memoryCreate({ projectPath, ...fields });
          if (!res.success || !res.data) {
            setSaveError(res.error ?? 'Could not create the memory.');
            return;
          }
          file = res.data.file;
        } else {
          const guard = expected ?? draft.target;
          const res = await window.electronAPI.memoryUpdate({
            projectPath,
            file: draft.target.file,
            ...fields,
            expectedMtimeMs: guard.mtimeMs,
            expectedSizeBytes: guard.sizeBytes,
          });
          if (!res.success || !res.data) {
            setSaveError(res.error ?? 'Could not save the memory.');
            return;
          }
          if (!res.data.ok) {
            setStale({ mtimeMs: res.data.currentMtimeMs, sizeBytes: res.data.currentSizeBytes });
            return;
          }
          file = draft.target.file;
          const { relinked } = res.data;
          if (relinked.length > 0) {
            toast(
              `Moved links in ${relinked.length} other ${relinked.length === 1 ? 'memory' : 'memories'} to the new name`,
              { description: relinked.join(', ') },
            );
          }
        }
        await reload();
        open(null);
        onSaved(file, draft.fields.type);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [draft, saving, projectPath, reload, open, onSaved],
  );

  const reloadFromDisk = useCallback(async () => {
    const file = draft?.target?.file;
    if (!file) return;
    if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    const entry = (await reload())?.entries.find((e) => e.file === file);
    // Gone from disk: there is nothing left to edit.
    open(entry ? editMemoryDraft(entry) : null);
  }, [draft, reload, open]);

  return {
    draft,
    saving,
    stale: stale !== null,
    saveError,
    startNew: (type) => {
      if (discard()) open(newMemoryDraft(type));
    },
    startEdit: (entry) => {
      if (discard()) open(editMemoryDraft(entry));
    },
    change: (fields) => setDraft((d) => (d ? { ...d, fields } : d)),
    save: () => save(),
    overwrite: async () => {
      if (stale) await save(stale);
    },
    reloadFromDisk,
    dismissStale: () => setStale(null),
    dismissError: () => setSaveError(null),
    discard,
  };
}
