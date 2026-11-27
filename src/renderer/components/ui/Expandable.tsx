import React, { useState } from 'react';
import { cn } from '../../lib/cn';
import { DisclosureChevron } from './DisclosureChevron';
import { focusRing } from './styles';

interface ExpandableProps {
  label: string;
  /** Open on first render — pass true when the section already has content. */
  defaultOpen?: boolean;
  /** Quiet text after the label (e.g. "optional"). */
  hint?: string;
  children: React.ReactNode;
}

/** A light disclosure for optional fields in a form (a context prompt,
 *  worktree scripts): the shared `DisclosureChevron` and a field label
 *  (`type-label`, as `Field`'s) that fold the children away with the drawer
 *  motion (`.collapse-grid`). Forms only; a section inside a view is a
 *  collapsible `DetailSection` (D273). */
export function Expandable({ label, defaultOpen = false, hint, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('-ml-0.5 flex items-center gap-1 rounded-sm', focusRing)}
      >
        <DisclosureChevron open={open} />
        <span className="type-label">{label}</span>
        {hint && <span className="type-caption">{hint}</span>}
      </button>
      <div className="collapse-grid" data-open={open}>
        <div className="pt-1.5">{children}</div>
      </div>
    </div>
  );
}
