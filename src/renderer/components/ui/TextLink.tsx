import * as React from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const base = cn(
  'cursor-pointer rounded-sm underline-offset-2 transition-colors decoration-ink-3 hover:decoration-ink',
  focusRing,
);

const tones = { ink: 'text-ink', inherit: 'hover:text-ink' } as const;

/**
 * A link inside text. `href` opens in the browser; `onClick` acts in the app
 * (rendered as a button). In running text it is underlined so it reads as a
 * link; `quiet` (a value in a row, a name in a meta line) underlines only on
 * hover. It inherits size and weight and takes ink, so it shows against the
 * quieter text around it; `tone="inherit"` keeps the text's own ink (a link in
 * secondary prose, told apart by its underline) and brightens to ink on hover.
 */
export function TextLink({
  href,
  onClick,
  quiet = false,
  tone = 'ink',
  title,
  children,
}: {
  /** An http(s) URL, opened with the system browser. */
  href?: string;
  onClick?: () => void;
  quiet?: boolean;
  /** `ink` (default) sets the link apart by colour; `inherit` takes the
   *  surrounding ink and leaves the underline to mark it. */
  tone?: keyof typeof tones;
  /** Hover text. */
  title?: string;
  children: React.ReactNode;
}) {
  const classes = cn(base, tones[tone], quiet ? 'hover:underline' : 'underline');
  if (href) {
    return (
      <a
        href={href}
        title={title}
        className={classes}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick?.();
          void window.electronAPI.openExternal(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      title={title}
      className={cn(classes, 'text-left')}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}
