import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface ExpandableProps {
  label: string;
  /** Open on first render — pass true when the section already has content. */
  defaultOpen?: boolean;
  /** Small trailing hint shown next to the label while collapsed (e.g. "optional"). */
  hint?: string;
  children: React.ReactNode;
}

/** A lightweight disclosure: a clickable label row with a chevron that toggles
 *  its children. Used to keep optional fields (context prompts) tucked away.
 *  Content height animates open/closed via the `.collapse-grid` helper. */
export function Expandable({ label, defaultOpen = false, hint, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={13}
          strokeWidth={2}
          className={`transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            open ? 'rotate-90' : ''
          }`}
        />
        {label}
        {hint && <span className="text-muted-foreground/40 font-normal">{hint}</span>}
      </button>
      <div className="collapse-grid" data-open={open}>
        <div className="pt-2">{children}</div>
      </div>
    </div>
  );
}
