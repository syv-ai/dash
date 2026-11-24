import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Pin, X } from 'lucide-react';
import { FolderTab } from '../ui/FolderTab';
import { cn } from '../../lib/cn';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { useSettings } from '../../stores/settingsStore';
import { formatBinding } from '../../keybindings';
import { dirtyVersion, isDirty, subscribeDirty, workingUri } from './models';
import { absolutePath } from './editor/fileRef';
import { tabsInScope } from './tabs/editorLayout';

interface Props {
  cwd: string;
  tabs: string[];
  active: string | null;
  /** The preview tab (italic): the next file opened in passing replaces it. */
  preview: string | null;
  /** The group "open" and the keyboard act on. */
  focused: boolean;
  onSelect(path: string): void;
  /** Close these tabs (one, or a "Close others/to the right/all"). */
  onClose(paths: string[]): void;
  /** Keep the preview tab open (double-click, or "Keep open"). */
  onPin(path: string): void;
  /** Before the tabs (the file tree's toggle). */
  leading?: ReactNode;
  /** Shown before the actions (the language-server status). */
  trailing?: ReactNode;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A group's open files as folder tabs over its sheet (the active one opens
 *  into it), with a dirty dot on unsaved ones and the preview tab in italics;
 *  right-click for keep/close commands. The strip overlaps the sheet by 1px so the
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
  trailing,
}: Props) {
  useSyncExternalStore(subscribeDirty, dirtyVersion);
  const closeBinding = useSettings((s) => s.keybindings.closeEditorTab);
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
          // A file shows its name (its path on hover).
          const title = path;
          const label = basename(path);
          const dirty = isDirty(workingUri(absolutePath(cwd, path)));
          const isActive = path === active;
          const isPreview = path === preview;
          return (
            <ContextMenu key={path}>
              <ContextMenuTrigger asChild>
                <FolderTab
                  title={isPreview ? `${title} (preview)` : title}
                  active={isActive}
                  muted={!focused}
                  onSelect={() => onSelect(path)}
                  onDoubleClick={() => onPin(path)}
                  onClose={() => onClose([path])}
                  closeLabel={`Close ${title}`}
                  indicator={
                    <span
                      aria-label={dirty ? 'Unsaved changes' : undefined}
                      className={`size-1.5 rounded-full ${dirty ? 'bg-ink-2' : ''}`}
                    />
                  }
                >
                  <span className={isPreview ? 'italic' : undefined}>{label}</span>
                </FolderTab>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems
                  items={[
                    {
                      label: 'Keep open',
                      icon: Pin,
                      disabled: !isPreview,
                      onSelect: () => onPin(path),
                    },
                    'separator',
                    {
                      label: 'Close',
                      icon: X,
                      shortcut: closeBinding ? formatBinding(closeBinding) : undefined,
                      onSelect: () => onClose([path]),
                    },
                    {
                      label: 'Close others',
                      disabled: tabs.length < 2,
                      onSelect: () => onClose(tabsInScope(tabs, path, 'others')),
                    },
                    {
                      label: 'Close to the right',
                      disabled: path === tabs[tabs.length - 1],
                      onSelect: () => onClose(tabsInScope(tabs, path, 'right')),
                    },
                    {
                      label: 'Close all',
                      onSelect: () => onClose(tabsInScope(tabs, path, 'all')),
                    },
                  ]}
                />
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}
