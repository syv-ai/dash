import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { TerminalSnapshot } from '@shared/types';

const MAX_SNAPSHOT_SIZE = 8 * 1024 * 1024; // 8MB per snapshot
const MAX_TOTAL_SIZE = 64 * 1024 * 1024; // 64MB total

class TerminalSnapshotServiceImpl {
  private snapshotsDir: string;

  constructor() {
    this.snapshotsDir = path.join(app.getPath('userData'), 'terminal-snapshots');
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  async saveSnapshot(id: string, payload: TerminalSnapshot): Promise<void> {
    const data = JSON.stringify(payload);

    // Validate size
    if (Buffer.byteLength(data) > MAX_SNAPSHOT_SIZE) {
      return; // Skip oversized snapshots
    }

    const filePath = this.getFilePath(id);
    fs.writeFileSync(filePath, data, 'utf-8');

    // Prune if total exceeds limit
    this.pruneIfNeeded();
  }

  async getSnapshot(id: string): Promise<TerminalSnapshot | null> {
    const filePath = this.getFilePath(id);

    if (!fs.existsSync(filePath)) return null;

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const snapshot = JSON.parse(data) as TerminalSnapshot;
      if (snapshot.version !== 1) return null;
      return snapshot;
    } catch {
      return null;
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  hasSnapshot(id: string): boolean {
    return fs.existsSync(this.getFilePath(id));
  }

  private getFilePath(id: string): string {
    // Sanitize id for filesystem
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.snapshotsDir, `${sanitized}.json`);
  }

  private pruneIfNeeded(): void {
    try {
      const files = fs.readdirSync(this.snapshotsDir);
      let totalSize = 0;

      const fileInfos = files
        .map((f) => {
          const filePath = path.join(this.snapshotsDir, f);
          const stat = fs.statSync(filePath);
          totalSize += stat.size;
          return { path: filePath, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime); // Oldest first

      // Delete oldest until under limit
      while (totalSize > MAX_TOTAL_SIZE && fileInfos.length > 0) {
        const oldest = fileInfos.shift()!;
        fs.unlinkSync(oldest.path);
        totalSize -= oldest.size;
      }
    } catch {
      // Best effort
    }
  }
}

export const terminalSnapshotService = new TerminalSnapshotServiceImpl();
