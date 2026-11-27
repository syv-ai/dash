import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { IconButton } from './IconButton';
import { Input } from './Input';

/** A name a shell takes: letters, digits and `_`, not starting with a digit. */
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Environment variables as `NAME = value` rows: one per variable with a
 * remove button, and a last row to add one (Enter or +). Settings → Claude's
 * global list and Task settings' per-task one.
 */
export function EnvVarList({
  value,
  onChange,
  canAdd = (name) => SHELL_NAME.test(name),
}: {
  value: Readonly<Record<string, string>>;
  onChange: (next: Record<string, string>) => void;
  /** Whether a typed name may be added (the + button). */
  canAdd?: (name: string) => boolean;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const addable = canAdd(newKey.trim());

  function add() {
    const key = newKey.trim();
    if (!canAdd(key)) return;
    onChange({ ...value, [key]: newValue });
    setNewKey('');
    setNewValue('');
  }

  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') add();
  };

  return (
    <div className="grid gap-1.5">
      {Object.entries(value).map(([key, val]) => (
        <EnvVarRow
          key={key}
          name={<Input readOnly value={key} aria-label="Name" mono />}
          value={<Input readOnly value={val} aria-label={`${key} value`} mono />}
          action={
            <IconButton title={`Remove ${key}`} onClick={() => remove(key)}>
              <Trash2 size={14} strokeWidth={1.8} />
            </IconButton>
          }
        />
      ))}
      <EnvVarRow
        name={
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={onEnter}
            placeholder="NAME"
            aria-label="New variable name"
            mono
          />
        }
        value={
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={onEnter}
            placeholder="value"
            aria-label="New variable value"
            mono
          />
        }
        action={
          <IconButton title="Add variable" onClick={add} disabled={!addable}>
            <Plus size={14} strokeWidth={1.8} />
          </IconButton>
        }
      />
    </div>
  );
}

function EnvVarRow({
  name,
  value,
  action,
}: {
  name: React.ReactNode;
  value: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{name}</div>
      <span className="type-caption">=</span>
      <div className="min-w-0 flex-1">{value}</div>
      {action}
    </div>
  );
}
