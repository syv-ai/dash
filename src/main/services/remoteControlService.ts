import type { WebContents } from 'electron';
import type { RemoteControlState } from '@shared/types';

const MAX_BUFFER = 8 * 1024;
const WATCH_TIMEOUT = 15_000;

const URL_REGEX = /https:\/\/claude\.ai\/code\/[a-zA-Z0-9_-]+/;

// Strip ANSI escape sequences so they don't break URL matching
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

interface Watcher {
  buffer: string;
  timer: ReturnType<typeof setTimeout>;
}

class RemoteControlServiceImpl {
  private states = new Map<string, RemoteControlState>();
  private watchers = new Map<string, Watcher>();
  private sender: WebContents | null = null;

  setSender(sender: WebContents): void {
    this.sender = sender;
  }

  startWatching(ptyId: string): void {
    // Clear any existing watcher
    this.stopWatching(ptyId);

    const timer = setTimeout(() => {
      this.stopWatching(ptyId);
      // Emit null state so the modal can show a timeout/error
      this.states.delete(ptyId);
      this.emit(ptyId, null);
    }, WATCH_TIMEOUT);

    this.watchers.set(ptyId, { buffer: '', timer });
  }

  onPtyData(ptyId: string, data: string): void {
    const watcher = this.watchers.get(ptyId);
    if (!watcher) return;

    watcher.buffer += data;
    // Trim buffer if it gets too large
    if (watcher.buffer.length > MAX_BUFFER) {
      watcher.buffer = watcher.buffer.slice(-MAX_BUFFER);
    }

    const clean = watcher.buffer.replace(ANSI_RE, '');
    const match = clean.match(URL_REGEX);
    if (match) {
      const url = match[0];
      const state: RemoteControlState = { url, active: true };
      this.states.set(ptyId, state);
      this.stopWatching(ptyId);
      this.emit(ptyId, state);
    }
  }

  unregister(ptyId: string): void {
    this.stopWatching(ptyId);
    if (this.states.delete(ptyId)) {
      this.emit(ptyId, null);
    }
  }

  getState(ptyId: string): RemoteControlState | null {
    return this.states.get(ptyId) ?? null;
  }

  getAllStates(): Record<string, RemoteControlState> {
    const result: Record<string, RemoteControlState> = {};
    for (const [id, state] of this.states) {
      result[id] = state;
    }
    return result;
  }

  private stopWatching(ptyId: string): void {
    const watcher = this.watchers.get(ptyId);
    if (watcher) {
      clearTimeout(watcher.timer);
      this.watchers.delete(ptyId);
    }
  }

  private emit(ptyId: string, state: RemoteControlState | null): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('rc:stateChanged', { ptyId, state });
    }
  }
}

export const remoteControlService = new RemoteControlServiceImpl();
