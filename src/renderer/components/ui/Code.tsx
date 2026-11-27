import * as React from 'react';
import { cn } from '../../lib/cn';

const looks = {
  /** Mono on a faint tint: the default. */
  tint: 'bg-select',
  /** Mono on a fainter tint inside a hairline: the text sits nearly on the
   *  surface, so it keeps the text's own contrast (a PR's description). */
  outline: 'bg-hover ring-1 ring-line ring-inset',
} as const;

export type CodeLook = keyof typeof looks;

/** The look of `Code` below a point in the tree (`Markdown`'s `codeLook`). */
export const CodeLookContext = React.createContext<CodeLook>('tint');

/** Inline code in running text (a command, a path, an env var): mono, a
 *  touch smaller than the text around it, on a tint (`CodeLookContext`). */
export function Code({ className, ...props }: React.ComponentProps<'code'>) {
  const look = React.useContext(CodeLookContext);
  return (
    <code
      className={cn(
        'rounded-sm px-1 py-px font-mono text-[0.92em] wrap-anywhere',
        looks[look],
        className,
      )}
      {...props}
    />
  );
}
