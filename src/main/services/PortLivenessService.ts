import * as net from 'net';
import { BrowserWindow } from 'electron';
import type { PortLiveness, PortLivenessUpdate } from '@shared/types';

const POLL_INTERVAL_MS = 2000;
const CONNECT_TIMEOUT_MS = 200;

interface WatchEntry {
  ports: number[];
  states: Map<number, PortLiveness>;
  timer: NodeJS.Timeout;
}

/**
 * Probes the ports declared for each watched task via a 200ms TCP connect to
 * 127.0.0.1. The connect succeeds the moment any process is `LISTEN`ing on
 * that port — exactly the "is the dev server up?" signal we want for the
 * panel's status dots. Anything else (RST, timeout, ECONNREFUSED) is `down`.
 *
 * One timer per watched task instead of one global tick so that adding/
 * removing a task doesn't reshuffle every other task's probe phase, and so
 * task removal cleans up cleanly without a sweep.
 */
class PortLivenessService {
  private watches = new Map<string, WatchEntry>();

  /**
   * Start (or refresh) liveness polling for a task. Replacing the port set
   * preserves the existing states for ports still present so the dot doesn't
   * flicker through 'unknown' on every config edit.
   */
  watchTask(taskId: string, ports: number[]): void {
    const previous = this.watches.get(taskId);
    if (previous) clearInterval(previous.timer);

    const states = new Map<number, PortLiveness>();
    for (const p of ports) {
      const prior = previous?.states.get(p);
      states.set(p, prior ?? 'unknown');
    }

    if (ports.length === 0) {
      this.watches.delete(taskId);
      this.broadcast({ taskId, results: {} });
      return;
    }

    const probe = () => {
      void this.probeAll(taskId);
    };
    const timer = setInterval(probe, POLL_INTERVAL_MS);
    timer.unref?.();
    this.watches.set(taskId, { ports, states, timer });

    // Kick a first probe immediately so the panel doesn't sit on 'unknown'
    // for two seconds after opening a task.
    probe();
  }

  unwatchTask(taskId: string): void {
    const entry = this.watches.get(taskId);
    if (!entry) return;
    clearInterval(entry.timer);
    this.watches.delete(taskId);
  }

  getStates(taskId: string): Record<number, PortLiveness> {
    const entry = this.watches.get(taskId);
    if (!entry) return {};
    return Object.fromEntries(entry.states);
  }

  /** Clear every watcher (called on app quit). */
  clearAll(): void {
    for (const entry of this.watches.values()) clearInterval(entry.timer);
    this.watches.clear();
  }

  private async probeAll(taskId: string): Promise<void> {
    const entry = this.watches.get(taskId);
    if (!entry) return;

    const results = await Promise.all(
      entry.ports.map(async (port) => ({ port, state: await probePort(port) })),
    );

    // The entry may have been replaced/removed while we awaited.
    const current = this.watches.get(taskId);
    if (!current || current !== entry) return;

    let changed = false;
    for (const { port, state } of results) {
      if (current.states.get(port) !== state) {
        current.states.set(port, state);
        changed = true;
      }
    }
    if (!changed) return;

    this.broadcast({ taskId, results: Object.fromEntries(current.states) });
  }

  private broadcast(update: PortLivenessUpdate): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('ports:liveness', update);
    }
  }
}

function probePort(port: number): Promise<PortLiveness> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (state: PortLiveness) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish('up'));
    socket.once('timeout', () => finish('down'));
    socket.once('error', () => finish('down'));

    try {
      socket.connect(port, '127.0.0.1');
    } catch {
      finish('down');
    }
  });
}

export const portLivenessService = new PortLivenessService();
