import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge, validators } from 'tailwind-merge';

/**
 * tailwind-merge taught Dash's theme (index.css `@theme`): the five text sizes
 * and five radii, so `text-sm` vs `text-ink-2` and `rounded-md` vs `rounded-xl`
 * resolve as size/colour and radius/radius; and `fade-N`, which sets opacity.
 */
const twMerge = extendTailwindMerge({
  override: {
    theme: {
      text: ['xs', 'sm', 'base', 'lg', 'xl'],
      radius: ['sm', 'md', 'lg', 'xl', '2xl'],
    },
  },
  extend: {
    classGroups: {
      opacity: [{ fade: [validators.isNumber] }],
    },
  },
});

/** Join class names (clsx) and let later Tailwind classes win (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
