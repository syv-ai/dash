import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import type { CiState } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/Tooltip';
import { ciLabel, ciPulse, ciText } from '../ui/prStatusColors';

/** A PR's checks rolled up into one icon: a tick when all pass (or skip), a
 *  cross when any fails, an amber pulse while any runs, coloured as the PR
 *  badge colours an open PR's checks (Overview's folded Checks band, the PR
 *  button's list). */
export function ChecksRollupIcon({ ci }: { ci: CiState }) {
  const Icon = ci === 'failing' ? CircleX : ci === 'pending' ? CircleDashed : CircleCheck;
  const label = ciLabel(ci);
  return (
    <Tooltip
      content={{
        icon: Icon,
        title: 'Checks',
        body: label.charAt(0).toUpperCase() + label.slice(1),
      }}
    >
      <span className={cn('flex', ciText(ci), ciPulse(ci))}>
        <Icon size={14} strokeWidth={1.8} aria-label={label} />
      </span>
    </Tooltip>
  );
}
