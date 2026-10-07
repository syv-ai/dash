import { useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { MemoryEntry } from '../../../shared/types';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { SaveErrorBanner } from '../diffEditor/editor/SaveErrorBanner';
import { StaleBanner } from '../diffEditor/editor/StaleBanner';
import { MemoryIssues } from './MemoryIssues';
import { MemoryPreview } from './MemoryPreview';
import {
  brokenLinks,
  canSaveDraft,
  draftTypes,
  redescribeDraft,
  repointLink,
  retypeDraft,
  unlinkLink,
  MEMORY_HOOK_PLACEHOLDERS,
  MEMORY_TYPE_HINTS,
  MEMORY_TYPE_LABELS,
  type MemoryDraft,
} from './memoryView';
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
  const self = draft.target?.file;

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

      {/* The links as written so far: fixed here, they are saved with the rest. */}
      <MemoryIssues
        issues={[]}
        broken={brokenLinks(fields.body, entries, self)}
        candidates={entries.filter((e) => e.file !== self)}
        onRepoint={(link, to) => set({ body: repointLink(fields.body, link, to, entries) })}
        onUnlink={(link) => set({ body: unlinkLink(fields.body, link) })}
      />

      <div className="shrink-0 space-y-2.5 border-b border-border/40 px-5 py-3">
        {/* The type comes first: it decides what the memory is for and how it starts. */}
        <div className="space-y-1">
          <span className="block text-[10px] uppercase tracking-[0.08em] text-fg-fade-45">
            Type
          </span>
          <Segmented
            size="sm"
            value={fields.type}
            onChange={(type) => api.change(retypeDraft(draft, type))}
            options={draftTypes(draft).map((t) => ({ value: t, label: MEMORY_TYPE_LABELS[t] }))}
          />
          <p className="text-[11px] text-muted-foreground">{MEMORY_TYPE_HINTS[fields.type]}</p>
        </div>
        <Field label="Name">
          <input
            autoFocus
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="prefer-ci-over-local-tests"
            className={fieldClass}
          />
        </Field>
        <Field label="Description">
          <input
            value={fields.description}
            onChange={(e) => api.change(redescribeDraft(draft, e.target.value))}
            placeholder="One line Claude uses to decide when this memory is relevant"
            className={fieldClass}
          />
        </Field>
        <Field label={`Hook in ${MEMORY_INDEX_FILE}`}>
          <input
            value={fields.hook}
            onChange={(e) => set({ hook: e.target.value })}
            disabled={draft.line === 'shared'}
            placeholder={MEMORY_HOOK_PLACEHOLDERS[draft.line]}
            title="The one line of this memory Claude reads at the start of every session"
            className={`${fieldClass} disabled:cursor-not-allowed disabled:text-muted-foreground`}
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

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-[0.08em] text-fg-fade-45">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
