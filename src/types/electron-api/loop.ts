import type { IpcResponse, LoopStatus } from '../../shared/types';

/** Lifecycle + status for agentic loops (main's LoopController). See loopIpc.ts. */
export interface LoopApi {
  /** Seed the spine, spawn the manager, and start the scheduler (worker iter 1). */
  loopStart: (taskId: string) => Promise<IpcResponse<LoopStatus | null>>;
  loopPause: (taskId: string) => Promise<IpcResponse<LoopStatus | null>>;
  loopResume: (taskId: string) => Promise<IpcResponse<LoopStatus | null>>;
  loopStop: (taskId: string) => Promise<IpcResponse<void>>;
  /** Current status of every running loop, keyed by taskId (mount hydration). */
  loopGetAllStatus: () => Promise<IpcResponse<Record<string, LoopStatus>>>;
  /** Push channel: fires whenever a loop's scheduler state changes. */
  onLoopStatus: (callback: (status: LoopStatus) => void) => () => void;
}
