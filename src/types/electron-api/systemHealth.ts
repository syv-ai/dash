import type {
  HealthPoint,
  MemoryAlert,
  SystemHealthConfig,
  SystemHealthSnapshot,
} from '../../shared/systemHealth';

/**
 * System health. The renderer pushes its settings; main samples while the
 * warning or the health icon is on, sends `systemHealth:alert` when Dash's
 * memory crosses the threshold or the OS reports pressure, and a
 * `systemHealth:snapshot` after every sample while the icon is on (faster
 * while its popover is open: `systemHealthSetLive`). Main keeps the
 * popover's timeline; it asks for it once as it opens (`systemHealthHistory`).
 */
export interface SystemHealthApi {
  systemHealthConfigure: (config: SystemHealthConfig) => void;
  onMemoryAlert: (callback: (alert: MemoryAlert) => void) => () => void;
  systemHealthSetLive: (live: boolean) => void;
  systemHealthHistory: () => Promise<HealthPoint[]>;
  onSystemHealthSnapshot: (callback: (snapshot: SystemHealthSnapshot) => void) => () => void;
}
