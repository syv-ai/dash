import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tab, type TabProps } from './Tab';

const pillTabVariants = cva(
  cn(
    'group/tab relative flex h-6 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md px-2.5 select-none transition-colors duration-150',
    focusRing,
  ),
  {
    variants: {
      // Plain on the select tint when active; `primary` (Dash speaking, e.g. a
      // wizard) and `service` (a dev server) carry a wash of their own.
      tone: { plain: '', primary: '', service: '' },
      active: { true: 'text-ink', false: 'text-ink-2 hover:text-ink' },
      // The active tab of a group that isn't focused: marked, but quieter.
      muted: { true: '', false: '' },
    },
    compoundVariants: [
      { tone: 'plain', active: true, className: 'bg-select' },
      { tone: 'plain', active: false, className: 'hover:bg-hover' },
      { tone: 'primary', active: true, className: 'bg-primary/20' },
      { tone: 'primary', active: false, className: 'bg-primary/10 hover:bg-primary/15' },
      { tone: 'service', active: true, className: 'bg-terminal-service/25' },
      {
        tone: 'service',
        active: false,
        className: 'bg-terminal-service/10 hover:bg-terminal-service/15',
      },
      { tone: 'plain', active: true, muted: true, className: 'bg-hover' },
    ],
    defaultVariants: { tone: 'plain', active: false, muted: false },
  },
);

export type PillTabProps = TabProps & VariantProps<typeof pillTabVariants>;

/**
 * A tab in a strip of open things (terminals, files): a pill, the Segmented
 * look, with an optional indicator and a hover ×. The strip owns layout.
 */
export const PillTab = React.forwardRef<HTMLDivElement, PillTabProps>(function PillTab(
  { tone, active, muted, className, ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      active={active}
      className={cn(pillTabVariants({ tone, active, muted }), className)}
      {...props}
    />
  );
});
