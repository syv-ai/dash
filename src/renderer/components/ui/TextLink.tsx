import * as React from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const base = cn(
  'cursor-pointer rounded-sm underline-offset-2 transition-colors hover:underline',
  focusRing,
);

const looks = {
  /** In running text: the link colour, underlined only on hover. */
  prose: 'text-link',
  /** A value in a row, a name in a meta line: ink, underlined on hover. */
  quiet: 'text-ink decoration-ink-3 hover:decoration-ink',
  /** Secondary text that leads somewhere (an empty state's status): ink-2,
   *  underlined on hover. */
  muted: 'text-ink-2 decoration-ink-3 hover:text-ink hover:decoration-ink',
} as const;

export type TextLinkLook = keyof typeof looks;

/**
 * A link inside text. `href` opens in the browser; `onClick` acts in the app
 * (rendered as a button). In running text it takes the `link` colour (a soft
 * blue, D191) and no underline until hovered; `quiet` (a value in a row, a
 * name in a meta line, a title) stays ink and `muted` (secondary text) ink-2,
 * both underlining on hover. It inherits size and weight.
 */
export function TextLink({
  href,
  onClick,
  look = 'prose',
  title,
  children,
}: {
  /** An http(s) URL, opened with the system browser. */
  href?: string;
  onClick?: () => void;
  look?: TextLinkLook;
  /** Hover text. */
  title?: string;
  children: React.ReactNode;
}) {
  const classes = cn(base, looks[look]);
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
