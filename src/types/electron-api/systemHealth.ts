import type { MemoryAlert, SystemHealthConfig } from '../../shared/systemHealth';

/**
 * The memory warning. The renderer pushes its setting; main samples while it
 * is on and sends `systemHealth:alert` when Dash's memory crosses the
 * threshold or the OS reports pressure.
 */
export interface SystemHealthApi {
  systemHealthConfigure: (config: SystemHealthConfig) => void;
  onMemoryAlert: (callback: (alert: MemoryAlert) => void) => () => void;
}
