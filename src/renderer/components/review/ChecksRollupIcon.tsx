import type { CiState } from '../../../shared/types';
import { CheckStateIcon } from '../ui/CheckStateIcon';
import { Tooltip } from '../ui/Tooltip';
import { checkLook, ciLabel } from '../ui/prStatusColors';

/** A PR's checks rolled up into one solid icon (`checkLook`): a tick when all
 *  pass (or skip), a cross when any fails, an amber pulse while any runs
 *  (Overview's folded Checks band, the PR button's list). */
export function ChecksRollupIcon({ ci }: { ci: CiState }) {
  const { icon } = checkLook(ci);
  const label = ciLabel(ci);
  return (
    <Tooltip
      content={{
        icon,
        title: 'Checks',
        body: label.charAt(0).toUpperCase() + label.slice(1),
      }}
    >
      <span className="flex">
        <CheckStateIcon state={ci} label={label} />
      </span>
    </Tooltip>
  );
}
