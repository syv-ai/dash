import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Columns2, X } from 'lucide-react';
import { PillTab } from '../ui/PillTab';
import { IconButton } from '../ui/IconButton';
import { dirtyVersion, isDirty, subscribeDirty, workingUri } from './models';
import { absolutePath } from './editor/fileRef';

interface Props {
  cwd: string;
  tabs: string[];
  active: string | null;
  /** The group "open" and the keyboard act on. */
  focused: boolean;
  onSelect(path: string): void;
  onClose(path: string): void;
  /** Open the active file in the other group (absent: nothing to split). */
  onSplit?: () => void;
  /** Close the whole editor (the last group's strip carries it). */
  onCloseEditor?: () => void;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A group's open files as pill tabs, with a dirty dot on unsaved ones; the
 *  split and close-editor actions at its end. */
export function EditorTabStrip({
  cwd,
  tabs,
  active,
  focused,
  onSelect,
  onClose,
  onSplit,
  onCloseEditor,
}: Props) {
  useSyncExternalStore(subscribeDirty, dirtyVersion);
  const trackRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in sight in a strip that scrolls.
  useEffect(() => {
    trackRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 pr-1 pl-1.5">
      <div
        ref={trackRef}
        role="tablist"
        aria-label="Open files"
        className="scrollbar-none flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((path) => {
          const dirty = isDirty(workingUri(absolutePath(cwd, path)));
          const isActive = path === active;
          return (
            <PillTab
              key={path}
              title={path}
              active={isActive}
              muted={!focused}
              onSelect={() => onSelect(path)}
              onClose={() => onClose(path)}
              closeLabel={`Close ${path}`}
              indicator={
                <span
                  aria-label={dirty ? 'Unsaved changes' : undefined}
                  className={`size-1.5 rounded-full ${dirty ? 'bg-ink-2' : ''}`}
                />
              }
            >
              <span className="font-mono">{basename(path)}</span>
            </PillTab>
          );
        })}
      </div>
      {onSplit && (
        <IconButton size="sm" title="Open to the side" onClick={onSplit}>
          <Columns2 size={14} strokeWidth={1.8} />
        </IconButton>
      )}
      {onCloseEditor && (
        <IconButton size="sm" title="Close editor" onClick={onCloseEditor}>
          <X size={14} strokeWidth={1.8} />
        </IconButton>
      )}
    </div>
  );
}
