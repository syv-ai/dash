import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { KeyBinding } from '../../keybindings';
import {
  DEFAULT_KEYBINDINGS,
  bindingFromEvent,
  getBindingKeys,
  groupByCategory,
} from '../../keybindings';
import { useSettings } from '../../stores/settingsStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { FormSection, SettingRow } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Kbd } from '../ui/Kbd';

function isModified(binding: KeyBinding): boolean {
  const def = DEFAULT_KEYBINDINGS[binding.id];
  if (!def) return false;
  return (
    binding.mod !== def.mod ||
    binding.shift !== def.shift ||
    binding.alt !== def.alt ||
    binding.key !== def.key
  );
}

/** Ctrl+Tab rotation: fixed, listed so it can be found. */
const FIXED = [
  { label: 'Next active task', keys: ['Ctrl', '⇥'] },
  { label: 'Previous active task', keys: ['Ctrl', '⇧', '⇥'] },
];

export function KeybindingsTab() {
  const keybindings = useSettings((s) => s.keybindings);
  const setKeybindings = useSettings((s) => s.setKeybindings);
  const modifiedCount = Object.values(keybindings).filter(isModified).length;

  const change = (id: string, updated: KeyBinding) =>
    setKeybindings({ ...keybindings, [id]: updated });
  const reset = (id: string) => {
    const def = DEFAULT_KEYBINDINGS[id];
    if (def) setKeybindings({ ...keybindings, [id]: { ...def } });
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <p className="type-caption flex-1">
          Click a shortcut, then press the new keys. Esc cancels.
          {modifiedCount > 0 && ` ${modifiedCount} changed.`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={modifiedCount === 0}
          onClick={() => setKeybindings({ ...DEFAULT_KEYBINDINGS })}
        >
          <RotateCcw size={14} strokeWidth={1.8} />
          Reset all
        </Button>
      </div>

      {groupByCategory(keybindings).map((group) => (
        <FormSection key={group.category} title={group.category} divided>
          {group.items.map((binding) => {
            const modified = isModified(binding);
            return (
              <SettingRow
                key={binding.id}
                label={
                  <span className="flex items-center gap-2">
                    {binding.label}
                    {modified && <Badge size="sm">Changed</Badge>}
                  </span>
                }
                control={
                  <span className="flex items-center gap-1">
                    <KeyRecorder binding={binding} onChange={(b) => change(binding.id, b)} />
                    <IconButton
                      size="sm"
                      title={modified ? 'Reset to default' : 'Default'}
                      disabled={!modified}
                      onClick={() => reset(binding.id)}
                    >
                      <RotateCcw size={14} strokeWidth={1.8} />
                    </IconButton>
                  </span>
                }
              />
            );
          })}
        </FormSection>
      ))}

      <FormSection title="Active tasks" description="Fixed; not rebindable." divided>
        {FIXED.map(({ label, keys }) => (
          <SettingRow key={label} label={label} control={<Keys keys={keys} />} />
        ))}
      </FormSection>
    </>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-0.5">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  );
}

/** The shortcut as keys; click to record a new one. */
function KeyRecorder({
  binding,
  onChange,
}: {
  binding: KeyBinding;
  onChange: (b: KeyBinding) => void;
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        setRecording(false);
        return;
      }
      const result = bindingFromEvent(e);
      if (!result) return;
      onChange({ ...binding, ...result });
      setRecording(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, binding, onChange]);

  useEffect(() => {
    if (!recording) ref.current?.blur();
  }, [recording]);

  return (
    <Button
      ref={ref}
      variant={recording ? 'secondary' : 'ghost'}
      size="sm"
      aria-label={`${binding.label}: change shortcut`}
      onClick={() => setRecording(true)}
    >
      {recording ? (
        <span className="motion-safe:animate-pulse">Press keys…</span>
      ) : (
        <Keys keys={getBindingKeys(binding)} />
      )}
    </Button>
  );
}
