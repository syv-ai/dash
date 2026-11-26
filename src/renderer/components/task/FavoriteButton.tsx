import type { Task } from '../../../shared/types';
import { FavoriteStar } from '../ui/FavoriteStar';
import { IconButton } from '../ui/IconButton';
import { useProjects } from '../../stores/projectsStore';

/** What the favourite toggle says, in a menu or a tooltip. */
export const favoriteLabel = (favorite: boolean) =>
  favorite ? 'Remove from favourites' : 'Add to favourites';

/** A task row's star: pins the task to the top of the task list, or unpins
 *  it. A favourite's is filled yellow and always shown; any other's shows on
 *  the row's hover. */
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
      <FavoriteStar on={task.favorite} />
    </IconButton>
  );
}
