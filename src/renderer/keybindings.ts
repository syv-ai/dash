export interface KeyBinding {
  id: string;
  label: string;
  category: string;
  mod: boolean;      // Cmd (mac) / Ctrl (win/linux)
  shift: boolean;
  alt: boolean;
  key: string;        // lowercase key value
}

export type KeyBindingMap = Record<string, KeyBinding>;

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

export const DEFAULT_KEYBINDINGS: KeyBindingMap = {
  // ── Tasks ──
  newTask: {
    id: 'newTask',
    label: 'New Task',
    category: 'Tasks',
    mod: true,
    shift: false,
    alt: false,
    key: 'n',
  },
  nextTask: {
    id: 'nextTask',
    label: 'Next Task',
    category: 'Tasks',
    mod: true,
    shift: true,
    alt: false,
    key: 'k',
  },
  prevTask: {
    id: 'prevTask',
    label: 'Previous Task',
    category: 'Tasks',
    mod: true,
    shift: true,
    alt: false,
    key: 'j',
  },
  // ── Git ──
  stageAll: {
    id: 'stageAll',
    label: 'Stage All Files',
    category: 'Git',
    mod: true,
    shift: true,
    alt: false,
    key: 'a',
  },
  unstageAll: {
    id: 'unstageAll',
    label: 'Unstage All Files',
    category: 'Git',
    mod: true,
    shift: true,
    alt: false,
    key: 'u',
  },
  commitGraph: {
    id: 'commitGraph',
    label: 'Commit Graph',
    category: 'Git',
    mod: true,
    shift: true,
    alt: false,
    key: 'g',
  },
  // ── Navigation ──
  openSettings: {
    id: 'openSettings',
    label: 'Open Settings',
    category: 'Navigation',
    mod: true,
    shift: false,
    alt: false,
    key: ',',
  },
  openFolder: {
    id: 'openFolder',
    label: 'Open Folder',
    category: 'Navigation',
    mod: true,
    shift: false,
    alt: false,
    key: 'o',
  },
  closeDiff: {
    id: 'closeDiff',
    label: 'Close Overlay',
    category: 'Navigation',
    mod: false,
    shift: false,
    alt: false,
    key: 'Escape',
  },
  focusTerminal: {
    id: 'focusTerminal',
    label: 'Focus Terminal',
    category: 'Navigation',
    mod: true,
    shift: false,
    alt: false,
    key: '`',
  },
  toggleShellDrawer: {
    id: 'toggleShellDrawer',
    label: 'Toggle Shell',
    category: 'Navigation',
    mod: true,
    shift: false,
    alt: false,
    key: 'j',
  },
};

const STORAGE_KEY = 'keybindings';

export function loadKeybindings(): KeyBindingMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<KeyBindingMap>;
      // Merge with defaults so new bindings always appear
      const merged: KeyBindingMap = {};
      for (const [id, def] of Object.entries(DEFAULT_KEYBINDINGS)) {
        merged[id] = parsed[id] ? { ...def, ...parsed[id] } : { ...def };
      }
      return merged;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_KEYBINDINGS };
}

export function saveKeybindings(bindings: KeyBindingMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const modMatch = binding.mod ? (e.metaKey || e.ctrlKey) : (!e.metaKey && !e.ctrlKey);
  const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = binding.alt ? e.altKey : !e.altKey;
  const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase();
  return modMatch && shiftMatch && altMatch && keyMatch;
}

/** Get individual key labels as an array for rendering as keycaps */
export function getBindingKeys(binding: KeyBinding): string[] {
  const keys: string[] = [];
  if (binding.mod) keys.push(isMac ? '\u2318' : 'Ctrl');
  if (binding.alt) keys.push(isMac ? '\u2325' : 'Alt');
  if (binding.shift) keys.push(isMac ? '\u21E7' : 'Shift');

  let keyLabel = binding.key;
  if (keyLabel === 'Escape') keyLabel = 'Esc';
  else if (keyLabel === ' ') keyLabel = 'Space';
  else if (keyLabel === 'ArrowUp') keyLabel = '\u2191';
  else if (keyLabel === 'ArrowDown') keyLabel = '\u2193';
  else if (keyLabel === 'ArrowLeft') keyLabel = '\u2190';
  else if (keyLabel === 'ArrowRight') keyLabel = '\u2192';
  else if (keyLabel === 'Enter') keyLabel = '\u21B5';
  else if (keyLabel === 'Backspace') keyLabel = '\u232B';
  else if (keyLabel === 'Delete') keyLabel = '\u2326';
  else if (keyLabel === 'Tab') keyLabel = '\u21E5';
  else if (keyLabel === '`') keyLabel = '`';
  else if (keyLabel === ',') keyLabel = ',';
  else keyLabel = keyLabel.toUpperCase();

  keys.push(keyLabel);
  return keys;
}

export function formatBinding(binding: KeyBinding): string {
  return getBindingKeys(binding).join(isMac ? '' : '+');
}

export function bindingFromEvent(e: KeyboardEvent): Omit<KeyBinding, 'id' | 'label' | 'category'> | null {
  // Ignore bare modifier presses
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null;

  return {
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
  };
}

/** Group bindings by category, preserving definition order */
export function groupByCategory(bindings: KeyBindingMap): { category: string; items: KeyBinding[] }[] {
  const groups: { category: string; items: KeyBinding[] }[] = [];
  const seen = new Set<string>();

  for (const binding of Object.values(bindings)) {
    if (!seen.has(binding.category)) {
      seen.add(binding.category);
      groups.push({ category: binding.category, items: [] });
    }
    groups.find((g) => g.category === binding.category)!.items.push(binding);
  }

  return groups;
}
