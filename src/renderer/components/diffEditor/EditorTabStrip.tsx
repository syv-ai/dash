import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Columns2, Pin, X } from 'lucide-react';
import { FolderTab } from '../ui/FolderTab';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { dirtyVersion, isDirty, subscribeDirty, workingUri } from './models';
import { absolutePath } from './editor/fileRef';

interface Props {
  cwd: string;
  tabs: string[];
  active: string | null;
  /** The preview tab (italic): the next file opened in passing replaces it. */
  preview: string | null;
  /** The group "open" and the keyboard act on. */
  focused: boolean;
  onSelect(path: string): void;
  onClose(path: string): void;
  /** Keep the preview tab open (double-click, or "Keep open"). */
  onPin(path: string): void;
  /** Before the tabs (the file tree's toggle). */
  leading?: ReactNode;
  /** Open the active file in the other group (absent: nothing to split). */
  onSplit?: () => void;
  /** Close the whole editor (the last group's strip carries it). */
  onCloseEditor?: () => void;
  /** Shown before the actions (the language-server status). */
  trailing?: ReactNode;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A group's open files as folder tabs over its sheet (the active one opens
 *  into it), with a dirty dot on unsaved ones and the preview tab in italics;
 *  the split and close-editor actions at its end. The strip overlaps the sheet by 1px so the
 *  active tab covers the sheet's top edge where they join. */
export function EditorTabStrip({
  cwd,
  tabs,
  active,
  preview,
  focused,
  onSelect,
  onClose,
  onPin,
  leading,
  onSplit,
  onCloseEditor,
  trailing,
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
    <div className="@container/strip relative z-10 -mb-px flex h-9 shrink-0 items-center gap-0.5 pr-1">
      {leading}
      {/* Margins, not padding, keep tabs off the sheet's 12px corners so a
          tab only ever meets its flat edge, scrolled or not: ml-3 (ml-1 after
          the leading toggle, which clears it already); mr-2 plus the pr-1. */}
      <div
        ref={trackRef}
        role="tablist"
        aria-label="Open files"
        className={cn(
          'scrollbar-none mr-2 flex h-full min-w-0 flex-1 items-end gap-0.5 overflow-x-auto',
          leading ? 'ml-1' : 'ml-3',
        )}
      >
        {tabs.map((path) => {
          const dirty = isDirty(workingUri(absolutePath(cwd, path)));
          const isActive = path === active;
          const isPreview = path === preview;
          return (
            <ContextMenu key={path}>
              <ContextMenuTrigger asChild>
                <FolderTab
                  title={isPreview ? `${path} (preview)` : path}
                  active={isActive}
                  muted={!focused}
                  onSelect={() => onSelect(path)}
                  onDoubleClick={() => onPin(path)}
                  onClose={() => onClose(path)}
                  closeLabel={`Close ${path}`}
                  indicator={
                    <span
                      aria-label={dirty ? 'Unsaved changes' : undefined}
                      className={`size-1.5 rounded-full ${dirty ? 'bg-ink-2' : ''}`}
                    />
                  }
                >
                  <span className={isPreview ? 'italic' : undefined}>{basename(path)}</span>
                </FolderTab>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem disabled={!isPreview} onSelect={() => onPin(path)}>
                  <Pin size={14} strokeWidth={1.8} />
                  Keep open
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onClose(path)}>
                  <X size={14} strokeWidth={1.8} />
                  Close
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {trailing}
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
