import type { ActivityInfo } from '../../../shared/types';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';

/** A task's agent state on the project page: the same StatusDot (and
 *  colours) as the sidebar, with the reason in a tooltip. */
export function ActivityDot({ info }: { info?: ActivityInfo }) {
  const [state, label]: [AgentState, string] = (() => {
    switch (info?.state) {
      case 'error':
        return [
          'fail',
          info.error?.type === 'rate_limit'
            ? 'Rate limited'
            : info.error?.type === 'authentication_failed'
              ? 'Auth error'
              : 'Error',
        ];
      case 'waiting':
        return ['needs', 'Waiting for you'];
      case 'busy':
        return [
          'work',
          info.compacting ? 'Compacting context…' : info.tool?.label || 'Claude is working',
        ];
      case 'idle':
        return ['idle', 'Idle'];
      default:
        return ['asleep', 'Asleep'];
    }
  })();
  if (state === 'asleep') return <StatusDot state="asleep" />;
  return (
    <Tooltip content={label}>
      <span className="inline-flex">
        <StatusDot state={state} label={label} />
      </span>
    </Tooltip>
  );
}
