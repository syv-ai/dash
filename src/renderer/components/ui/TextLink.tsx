import * as React from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const linkBase = cn(
  'cursor-pointer rounded-sm underline-offset-2 transition-colors hover:underline',
  focusRing,
);

/**
 * The one link look (D191, D272): the `link` colour, no underline until
 * hovered; it inherits size, weight and wrapping. Markdown's links take it
 * too; the only other look is `InkLinkSite`'s.
 */
export const linkClass = cn(linkBase, 'text-link');

/**
 * The places a link keeps the ink of the text around it, not link blue, and
 * still underlines on hover (D274, user-requested, each by name): the review
 * header's PR title, Files' "n commits ahead, m behind" and the task header's
 * branch. A closed list, not a look: a new place is a logged decision and a
 * new member here.
 */
export type InkLinkSite = 'review-title' | 'sync-text' | 'task-branch';

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
  inkAt,
  children,
}: {
  /** An http(s) URL, opened with the system browser. */
  href?: string;
  onClick?: () => void;
  /** Hover text. */
  title?: string;
  /** One of the logged places that keeps its text's ink (D274). */
  inkAt?: InkLinkSite;
  children: React.ReactNode;
}) {
  const className = inkAt ? linkBase : linkClass;
  if (href) {
    return (
      <a
        href={href}
        title={title}
        className={className}
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
      className={className}
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
