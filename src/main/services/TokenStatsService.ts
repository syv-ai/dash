import { BrowserWindow, WebContents } from 'electron';
import { DatabaseService } from './DatabaseService';
import { aggregateTokenStatsForTaskPath } from '../utils/taskTokenAggregator';
import type { TokenStatsRollup } from '../../shared/types';

export interface TokenStatsUpdate {
  taskId: string;
  totalTokens: number;
  totalCostUsd: number;
}

class TokenStatsServiceImpl {
  private sender: WebContents | null = null;
  private inflight = new Set<string>();
  private backfillRunning = false;

  setSender(sender: WebContents): void {
    this.sender = sender;
  }

  async recomputeForTask(taskId: string): Promise<void> {
    if (this.inflight.has(taskId)) return;
    this.inflight.add(taskId);
    try {
      const task = DatabaseService.getTask(taskId);
      if (!task) return;
      const stats = await aggregateTokenStatsForTaskPath(task.path);
      DatabaseService.updateTaskTokenStats(taskId, stats);
      this.broadcast({ taskId, ...stats });
    } catch (err) {
      console.warn('[TokenStatsService] recomputeForTask failed', { taskId, err });
    } finally {
      this.inflight.delete(taskId);
    }
  }

  async backfillPending(): Promise<void> {
    if (this.backfillRunning) return;
    this.backfillRunning = true;
    try {
      const pending = DatabaseService.listTasksNeedingBackfill();
      for (const t of pending) {
        await this.recomputeForTask(t.id);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.backfillRunning = false;
    }
  }

  getProjectStats(projectId: string): TokenStatsRollup {
    return DatabaseService.getProjectTokenStats(projectId);
  }

  getGlobalStats(): TokenStatsRollup {
    return DatabaseService.getGlobalTokenStats();
  }

  private broadcast(update: TokenStatsUpdate): void {
    if (this.sender && !this.sender.isDestroyed()) {
      try {
        this.sender.send('tokenStats:updated', update);
        return;
      } catch (err) {
        console.warn('[TokenStatsService] sender.send failed, falling back', err);
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send('tokenStats:updated', update);
      } catch (err) {
        console.warn('[TokenStatsService] broadcast failed', err);
      }
    }
  }
}

export const tokenStatsService = new TokenStatsServiceImpl();
