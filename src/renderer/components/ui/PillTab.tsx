import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tab, type TabProps } from './Tab';
import { TabIndicator } from './TabIndicator';

const pillTabVariants = cva(
  cn(
    'group/tab relative flex h-6 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md px-3 select-none transition-colors duration-150',
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
      // The active tint is the strip's sliding `TabIndicator`
      // (`pillTabIndicator`), not the tab's own.
      indicated: { true: '', false: '' },
    },
    compoundVariants: [
      { tone: 'plain', active: true, indicated: false, className: 'bg-select' },
      { tone: 'plain', active: false, className: 'hover:bg-hover' },
      { tone: 'primary', active: true, indicated: false, className: 'bg-primary/20' },
      { tone: 'primary', active: false, className: 'bg-primary/10 hover:bg-primary/15' },
      { tone: 'service', active: true, indicated: false, className: 'bg-terminal-service/25' },
      {
        tone: 'service',
        active: false,
        className: 'bg-terminal-service/10 hover:bg-terminal-service/15',
      },
      { tone: 'plain', active: true, muted: true, indicated: false, className: 'bg-hover' },
    ],
    defaultVariants: { tone: 'plain', active: false, muted: false, indicated: false },
  },
);

/** The active tab's tint as a sliding `TabIndicator`: the active tab's tone
 *  (it changes colour as it slides onto a tab of another tone). */
const pillTabIndicator = cva('rounded-md transition-colors duration-200', {
  variants: {
    tone: { plain: 'bg-select', primary: 'bg-primary/20', service: 'bg-terminal-service/25' },
    muted: { true: '', false: '' },
  },
  compoundVariants: [{ tone: 'plain', muted: true, className: 'bg-hover' }],
  defaultVariants: { tone: 'plain', muted: false },
});

export type PillTabProps = TabProps & VariantProps<typeof pillTabVariants>;

/**
 * A tab in a strip of open things (terminals, files): a pill, the Segmented
 * look, with an optional indicator and a hover ×. The strip owns layout.
 */
export const PillTab = React.forwardRef<HTMLDivElement, PillTabProps>(function PillTab(
  { tone, active, muted, indicated, className, ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      active={active}
      className={cn(pillTabVariants({ tone, active, muted, indicated }), className)}
      {...props}
    />
  );
});

/** A strip of `indicated` pill tabs' active tint, sliding from tab to tab
 *  (`TabIndicator`; the strip's first child), in the active tab's tone. */
export function PillTabIndicator({
  active,
  tone,
  muted,
}: { active: unknown } & VariantProps<typeof pillTabIndicator>) {
  return <TabIndicator active={active} className={pillTabIndicator({ tone, muted })} />;
}
