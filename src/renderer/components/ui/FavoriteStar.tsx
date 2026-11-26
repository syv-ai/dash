import { Star } from 'lucide-react';
import { Tooltip } from './Tooltip';

/**
 * A favourite task's mark beside its name: lucide `Star` as an outline,
 * stroked in the `favorite` yellow (the one place that colour shows, T12).
 * A label, not a control: favouriting is a menu item (T22).
 */
export function FavoriteStar() {
  return (
    <Tooltip content="Favourite">
      <span role="img" aria-label="Favourite" className="flex text-favorite">
        <Star size={11} strokeWidth={1.8} />
      </span>
    </Tooltip>
  );
}
