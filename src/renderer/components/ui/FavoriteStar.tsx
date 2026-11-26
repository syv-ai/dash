import { Star } from 'lucide-react';
import { Tooltip } from './Tooltip';

/**
 * A favourite task's mark beside its name: lucide `Star` as an outline,
 * stroked in the `changed` gold like the main-checkout M beside it (T27).
 * A label, not a control: favouriting is a menu item (T22).
 */
export function FavoriteStar() {
  return (
    <Tooltip content="Favourite">
      <span role="img" aria-label="Favourite" className="flex text-changed">
        <Star size={11} strokeWidth={1.8} />
      </span>
    </Tooltip>
  );
}
