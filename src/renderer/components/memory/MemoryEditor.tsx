import { useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { MemoryEntry } from '../../../shared/types';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { SaveErrorBanner } from '../diffEditor/editor/SaveErrorBanner';
import { StaleBanner } from '../diffEditor/editor/StaleBanner';
import { MemoryPreview } from './MemoryPreview';
import { canSaveDraft, draftTypes, MEMORY_TYPE_LABELS, type MemoryDraft } from './memoryView';
import type { MemoryDraftApi } from './useMemoryDraft';

interface Props {
  draft: MemoryDraft;
  api: MemoryDraftApi;
  entries: MemoryEntry[];
  isDark: boolean;
}

const fieldClass =
  'w-full rounded-lg border border-border/60 bg-transparent px-2.5 py-1.5 text-[12px] text-foreground outline-hidden placeholder:text-fg-fade-35 focus:border-primary/40';

const ignoreLink = () => {};

/** The modal's right pane while a memory is being created or edited. */
export function MemoryEditor({ draft, api, entries, isDark }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const { fields } = draft;
  const set = (patch: Partial<typeof fields>) => api.change({ ...fields, ...patch });
  const canSave = canSaveDraft(draft) && !api.saving;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void api.save();
        }
      }}
    >
      {api.stale && (
        <StaleBanner
          onOverwrite={() => void api.overwrite()}
          onReload={() => void api.reloadFromDisk()}
          onCancel={api.dismissStale}
        />
      )}
      {api.saveError && (
        <SaveErrorBanner
          message={api.saveError}
          onRetry={() => void api.save()}
          onDismiss={api.dismissError}
        />
      )}

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_160px] gap-x-3 gap-y-2.5 border-b border-border/40 px-5 py-3">
        <Field label="Name">
          <input
            autoFocus
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="prefer-ci-over-local-tests"
            className={fieldClass}
          />
        </Field>
        <Field label="Type">
          <Select
            value={fields.type}
            onValueChange={(type) => set({ type })}
            options={draftTypes(draft).map((t) => ({ value: t, label: MEMORY_TYPE_LABELS[t] }))}
            className="rounded-lg px-2.5 py-1.5"
          />
        </Field>
        <Field label="Description" className="col-span-2">
          <input
            value={fields.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="One line Claude uses to decide when this memory is relevant"
            className={fieldClass}
          />
        </Field>
      </div>

      <div className="flex shrink-0 items-center justify-between px-5 pt-3">
        <span className="text-[12px] font-semibold text-foreground">
          {draft.target ? draft.target.file : 'New memory'}
        </span>
        <Segmented
          size="sm"
          fullWidth={false}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 px-5 py-3">
        {tab === 'write' ? (
          <textarea
            value={fields.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="The fact, in Markdown. Link other memories with [[their-name]]."
            spellCheck={false}
            className="h-full w-full resize-none rounded-md bg-foreground/4 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-muted-fade-40 focus:outline-hidden"
          />
        ) : (
          <div className="h-full overflow-hidden rounded-md border border-border/40">
            <MemoryPreview
              markdown={fields.body}
              entries={entries}
              isDark={isDark}
              onOpenMemory={ignoreLink}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/40 px-5 py-3">
        <Button variant="secondary" size="sm" onClick={api.discard}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSave} onClick={() => void api.save()}>
          {api.saving && <Loader2 size={13} className="animate-spin" />}
          {draft.target ? 'Save' : 'Create'}
        </Button>
      </div>
    </div>
  );
}

function Field(props: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block space-y-1 ${props.className ?? ''}`}>
      <span className="block text-[10px] uppercase tracking-[0.08em] text-fg-fade-45">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
