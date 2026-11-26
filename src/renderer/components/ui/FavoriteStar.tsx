import { Star } from 'lucide-react';

/**
 * The favourite star at icon size: a favourite's is filled in the `favorite`
 * yellow (the one place that colour shows, T12); any other is an outline in
 * the colour around it (the icon token, ink on its button's hover).
 */
export function FavoriteStar({ on }: { on: boolean }) {
  return (
    <Star size={14} strokeWidth={1.8} className={on ? 'fill-current text-favorite' : undefined} />
  );
}
