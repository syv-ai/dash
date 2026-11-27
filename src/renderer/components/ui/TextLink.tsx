import * as React from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * The one link look (D191, D272): the `link` colour, no underline until
 * hovered; it inherits size, weight and wrapping. Markdown's links take it
 * too; there are no other looks.
 */
export const linkClass = cn(
  'cursor-pointer rounded-sm text-link underline-offset-2 transition-colors hover:underline',
  focusRing,
);

const isWebUrl = (href: string) => /^https?:\/\//i.test(href);

/**
 * A link inside text. `href` opens in the browser (http(s) only); `onClick`
 * acts in the app. Both render an inline `<a>` (an action is a
 * `role="button"` one, reached by Tab and fired by Enter or Space), never a
 * `<button>`: a button is an atomic inline box, so a long link inside a
 * truncating parent was cut off rather than ellipsized.
 */
export function TextLink({
  href,
  onClick,
  title,
  children,
}: {
  /** An http(s) URL, opened with the system browser. */
  href?: string;
  onClick?: () => void;
  /** Hover text. */
  title?: string;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <a
        href={href}
        title={title}
        className={linkClass}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick?.();
          if (isWebUrl(href)) void window.electronAPI.openExternal(href);
        }}
      >
        {children}
      </a>
    );
  }
  const act = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onClick?.();
  };
  return (
    <a
      role="button"
      tabIndex={0}
      title={title}
      className={linkClass}
      onClick={act}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        act(e);
      }}
    >
      {children}
    </a>
  );
}
