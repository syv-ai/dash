import type { PrCheck } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { checkLook } from './prStatusColors';

/**
 * A check's state (or a PR's rolled-up checks) as a solid icon: `checkLook`'s
 * lucide circle filled in its tone (`currentColor`), the glyph inside cut out
 * in `well` (white in light, the sheet in dark), pulsing while it runs. Lucide has no filled variants; filling
 * its own circle keeps the outline icons' geometry and stroke (14px, 1.8).
 */
export function CheckStateIcon({
  state,
  label,
}: {
  state: PrCheck['state'];
  /** Accessible name; omitted, the icon is decorative (a word beside it says it). */
  label?: string;
}) {
  const { icon: Icon, tone, pulse } = checkLook(state);
  return (
    <Icon
      size={14}
      strokeWidth={1.8}
      fill="currentColor"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'shrink-0 [&>:not(:first-child)]:fill-none [&>:not(:first-child)]:stroke-well',
        tone,
        pulse,
      )}
    />
  );
}
