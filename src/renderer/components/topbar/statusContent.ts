import type { ActivityInfo } from '../../../shared/types';

export type StatusTone = 'busy' | 'waiting' | 'error' | 'idle' | 'muted';

export interface StatusContent {
  label: string;
  tone: StatusTone;
}

export function statusContent(activity: ActivityInfo | undefined): StatusContent {
  if (!activity) return { label: 'No active task', tone: 'muted' };

  if (activity.state === 'busy') {
    if (activity.compacting) return { label: 'Compacting context…', tone: 'busy' };
    if (activity.tool?.label) return { label: activity.tool.label, tone: 'busy' };
    return { label: 'Working', tone: 'busy' };
  }

  if (activity.state === 'waiting') return { label: 'Waiting for input', tone: 'waiting' };

  if (activity.state === 'error') {
    switch (activity.error?.type) {
      case 'rate_limit':
        return { label: 'Rate limited', tone: 'error' };
      case 'auth_error':
        return { label: 'Authentication error', tone: 'error' };
      case 'billing_error':
        return { label: 'Billing error', tone: 'error' };
      default:
        return { label: 'Error', tone: 'error' };
    }
  }

  return { label: 'Idle', tone: 'idle' };
}
