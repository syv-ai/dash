import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface ExpandableProps {
  label: string;
  /** Open on first render — pass true when the section already has content. */
  defaultOpen?: boolean;
  /** Small trailing hint shown next to the label while collapsed (e.g. "optional"). */
  hint?: string;
  children: React.ReactNode;
}

/** A lightweight disclosure: a clickable label row with a chevron that toggles
 *  its children. Used to keep optional fields (context prompts) tucked away. */
export function Expandable({ label, defaultOpen = false, hint, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={2} />
        ) : (
          <ChevronRight size={13} strokeWidth={2} />
        )}
        {label}
        {hint && <span className="text-muted-foreground/40 font-normal">{hint}</span>}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
