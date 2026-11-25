import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Up to two letters for `name`: a display name's first and last words'
 *  ("Ann Reviewer" → "AR"), a login's first letter ("nthomsencph" → "N"). */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w));
  if (words.length === 0) return '?';
  const first = [...words[0]!][0]!;
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : '';
  return (first + last).toUpperCase();
}

/**
 * A person without a picture: their initials on a neutral disc (24px), or an
 * `icon` in it (the agent, a draft). `dashed` rings it in a dashed line, for
 * something not yet posted. Neutral by rule: colour means agent state.
 */
export function Avatar({
  name,
  icon: Icon,
  dashed = false,
  className,
}: {
  name: string;
  icon?: LucideIcon;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold leading-none text-ink-2',
        dashed ? 'border border-dashed border-ink-3' : 'bg-select',
        className,
      )}
    >
      {Icon ? <Icon size={14} strokeWidth={1.8} className="text-icon" /> : initials(name)}
    </span>
  );
}
