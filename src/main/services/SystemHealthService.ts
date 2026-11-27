import { execFile } from 'child_process';
import { promisify } from 'util';
import { app, BrowserWindow, Notification } from 'electron';
import {
  BYTES_PER_GB,
  healthLevel,
  MEMORY_WARNING_DEFAULT_GB,
  type MemoryAlert,
  type MemoryPressure,
  type SystemHealthConfig,
  type SystemHealthSnapshot,
  type TaskMemory,
} from '@shared/systemHealth';
import { DatabaseService } from './DatabaseService';
import { supervisorService } from './SupervisorService';
import { TelemetryService } from './TelemetryService';
import { countBucket, memoryBucket } from './telemetryBuckets';
import { parsePs, subtreeBytes, type ProcRow, type TreeRoot } from './processTree';
import {
  INITIAL_ALERT_STATE,
  parsePressureLevel,
  stepAlert,
  type AlertState,
} from './memoryAlertState';

const execFileAsync = promisify(execFile);

/** One sample costs a `ps` (~20 ms for 800 processes) and a `sysctl`. */
export const SAMPLE_MS = 45_000;
/** While the health popover is open, so its numbers move. */
export const LIVE_SAMPLE_MS = 5_000;
/** The first sample after the setting turns on or changes. */
const FIRST_SAMPLE_MS = 5_000;
const EXEC_TIMEOUT_MS = 5_000;
const TOP_TASKS = 3;

/** The key of Dash's main process in the tree walk (task keys are task ids). */
const DASH_ROOT = Symbol('dash');

interface Sample {
  at: number;
  totalBytes: number;
  pressure: MemoryPressure | null;
  tasks: TaskMemory[];
}

async function listProcesses(): Promise<ProcRow[]> {
  // No `ps` on Windows: there only Electron's own processes count.
  if (process.platform === 'win32') return [];
  try {
    const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,rss='], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parsePs(String(stdout));
  } catch (err) {
    console.warn('[SystemHealth] ps failed:', err);
    return [];
  }
}

/**
 * The OS's memory pressure. macOS only: `sysctl kern.memorystatus_vm_pressure_level`
 * is the kernel's own level (the one Activity Monitor's graph shows), a ~2 ms
 * read; `memory_pressure -Q` prints only a free percentage. Linux and Windows
 * have no equivalent this cheap, so there the threshold alone warns.
 */
async function readPressure(): Promise<MemoryPressure | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync(
      'sysctl',
      ['-n', 'kern.memorystatus_vm_pressure_level'],
      { timeout: EXEC_TIMEOUT_MS },
    );
    return parsePressureLevel(String(stdout));
  } catch {
    return null;
  }
}

/**
 * Watches how much memory Dash holds: its Electron processes
 * (`app.getAppMetrics()`), every other process under main (terminals,
 * services), and each task session's process tree under Claude Code's
 * supervisor (the session, its subagents, MCP servers and shells). On macOS it
 * also reads the OS's memory pressure.
 *
 * Two consumers, each a renderer setting (`configure`), and it samples only
 * while one is on:
 * - the warning: crossing the threshold, or the OS reporting pressure, sends
 *   one `systemHealth:alert` (memoryAlertState decides when), and a desktop
 *   notification while Dash is in the background;
 * - the sidebar's health icon: a `systemHealth:snapshot` after every sample,
 *   every SAMPLE_MS, or LIVE_SAMPLE_MS while its popover is open (`setLive`).
 * Both read the same `healthLevel`.
 */
class SystemHealthServiceImpl {
  private config: SystemHealthConfig = {
    alerts: false,
    indicator: false,
    thresholdGb: MEMORY_WARNING_DEFAULT_GB,
  };
  private live = false;
  private state: AlertState = INITIAL_ALERT_STATE;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sampling = false;
  private last: Sample | null = null;
  private loggedSource = false;

  private get active(): boolean {
    return this.config.alerts || this.config.indicator;
  }

  private get thresholdBytes(): number {
    return this.config.thresholdGb * BYTES_PER_GB;
  }

  configure(next: SystemHealthConfig): void {
    const prev = this.config;
    this.config = next;
    // A reloaded renderer, or a new threshold: the icon reads the last sample now.
    if (next.indicator && this.last) this.sendSnapshot(this.last);
    const changed =
      next.alerts !== prev.alerts ||
      next.indicator !== prev.indicator ||
      next.thresholdGb !== prev.thresholdGb;
    if (!changed) return;
    // A new threshold, or the warning back on, is a fresh question: warn on its first crossing.
    if (next.thresholdGb !== prev.thresholdGb || next.alerts !== prev.alerts) {
      this.state = INITIAL_ALERT_STATE;
    }
    this.clearTimer();
    if (this.active && !this.sampling) this.schedule(FIRST_SAMPLE_MS);
  }

  /** The popover is open: sample now, then every LIVE_SAMPLE_MS until it closes. */
  setLive(live: boolean): void {
    if (live === this.live) return;
    this.live = live;
    if (!live || !this.config.indicator || this.sampling) return;
    this.clearTimer();
    this.schedule(0);
  }

  stop(): void {
    this.config = { ...this.config, alerts: false, indicator: false };
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.sampling = true;
    try {
      const sample = await this.sample();
      this.last = sample;
      if (this.config.indicator) this.sendSnapshot(sample);
      if (this.config.alerts) this.checkAlert(sample);
    } catch (err) {
      console.warn('[SystemHealth] sample failed:', err);
    } finally {
      this.sampling = false;
      if (this.active && !this.timer) {
        this.schedule(this.live && this.config.indicator ? LIVE_SAMPLE_MS : SAMPLE_MS);
      }
    }
  }

  private checkAlert(sample: Sample): void {
    const thresholdBytes = this.thresholdBytes;
    const step = stepAlert(this.state, {
      totalBytes: sample.totalBytes,
      thresholdBytes,
      pressure: sample.pressure,
      now: sample.at,
    });
    this.state = step.state;
    if (step.alert) {
      this.alert({
        reason: step.alert,
        totalBytes: sample.totalBytes,
        thresholdBytes,
        pressure: sample.pressure,
        topTasks: sample.tasks.slice(0, TOP_TASKS),
      });
    }
  }

  private sendSnapshot(sample: Sample): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    const reading = {
      totalBytes: sample.totalBytes,
      thresholdBytes: this.thresholdBytes,
      pressure: sample.pressure,
    };
    const snapshot: SystemHealthSnapshot = {
      ...reading,
      level: healthLevel(reading),
      tasks: sample.tasks,
      sampledAt: sample.at,
    };
    win.webContents.send('systemHealth:snapshot', snapshot);
  }

  private async sample(): Promise<Sample> {
    const metrics = app.getAppMetrics();
    const electronPids = new Set(metrics.map((m) => m.pid));
    // workingSetSize is in KiB.
    const electronBytes = metrics.reduce((n, m) => n + m.memory.workingSetSize * 1024, 0);

    const [rows, pressure] = await Promise.all([listProcesses(), readPressure()]);

    const pidByJob = new Map<string, number>();
    for (const s of supervisorService.getSessions()) {
      if (s.id && s.pid !== undefined) pidByJob.set(s.id, s.pid);
    }
    const names = new Map<string, string>();
    const roots: TreeRoot<string | typeof DASH_ROOT>[] = [];
    for (const task of DatabaseService.getTasksWithSessions()) {
      const pid = task.jobId ? pidByJob.get(task.jobId) : undefined;
      if (pid === undefined || task.shelved) continue;
      names.set(task.id, task.name);
      roots.push({ key: task.id, pid });
    }
    // Last, so a session that runs under main still counts as its task.
    roots.push({ key: DASH_ROOT, pid: process.pid });

    const bytes = subtreeBytes(rows, roots, electronPids);
    let totalBytes = electronBytes;
    const tasks: TaskMemory[] = [];
    for (const [key, b] of bytes) {
      totalBytes += b;
      if (key !== DASH_ROOT) tasks.push({ taskId: key, name: names.get(key) ?? '', bytes: b });
    }
    tasks.sort((a, b) => b.bytes - a.bytes);

    if (!this.loggedSource) {
      this.loggedSource = true;
      console.log(
        `[SystemHealth] sampling every ${SAMPLE_MS / 1000}s: app metrics, ` +
          `${rows.length ? 'ps tree' : 'no ps'}, pressure ${
            process.platform === 'darwin' ? 'sysctl kern.memorystatus_vm_pressure_level' : 'none'
          }; now ${(totalBytes / BYTES_PER_GB).toFixed(2)} GB over ${tasks.length} sessions, pressure ${pressure ?? 'n/a'}`,
      );
    }
    return { at: Date.now(), totalBytes, pressure, tasks };
  }

  private alert(alert: MemoryAlert): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    const background = !win.isFocused();
    console.log(
      `[SystemHealth] alert (${alert.reason}): ${(alert.totalBytes / BYTES_PER_GB).toFixed(2)} GB, ` +
        `pressure ${alert.pressure ?? 'n/a'}, ${background ? 'background: notification' : 'focused: toast'}`,
    );
    win.webContents.send('systemHealth:alert', alert);
    if (background) this.notify(win, alert);
    TelemetryService.capture('memory_warning_shown', {
      reason: alert.reason,
      memory_bucket: memoryBucket(alert.totalBytes),
      live_session_count: countBucket(supervisorService.getSessions().filter((s) => s.pid).length),
    });
  }

  /** The desktop notification while Dash is in the background; the toast, with
   *  its action, waits in the window until Dash has focus. */
  private notify(win: BrowserWindow, alert: MemoryAlert): void {
    if (!Notification.isSupported()) return;
    try {
      const gb = (alert.totalBytes / BYTES_PER_GB).toFixed(1);
      const n = new Notification({
        title:
          alert.reason === 'pressure' ? 'Memory is running low' : 'Dash is using a lot of memory',
        body: `Dash and its sessions use ${gb} GB. Open Dash to put idle tasks to sleep.`,
      });
      n.on('click', () => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      n.show();
    } catch (err) {
      console.warn('[SystemHealth] notification failed:', err);
    }
  }
}

export const systemHealthService = new SystemHealthServiceImpl();
