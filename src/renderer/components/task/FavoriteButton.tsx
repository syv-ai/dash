import { Star } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import { useProjects } from '../../stores/projectsStore';

/** What the favourite toggle says, in a menu or a tooltip. */
export const favoriteLabel = (favorite: boolean) =>
  favorite ? 'Remove from favourites' : 'Add to favourites';

/** A task row's hover star: pins the task to the top of the task list, or
 *  unpins it. Filled while it is a favourite. */
export function FavoriteButton({ task }: { task: Task }) {
  const setFavorite = useProjects((s) => s.setFavorite);
  return (
    <IconButton
      size="sm"
      title={favoriteLabel(task.favorite)}
      aria-pressed={task.favorite}
      onClick={(e) => {
        e.stopPropagation();
        void setFavorite(task, !task.favorite);
      }}
    >
      <Star size={14} strokeWidth={1.8} className={task.favorite ? 'fill-current' : undefined} />
    </IconButton>
  );
}
