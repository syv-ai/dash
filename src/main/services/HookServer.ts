import * as http from 'http';
import { BrowserWindow, Notification } from 'electron';
import { eq } from 'drizzle-orm';
import { activityMonitor } from './ActivityMonitor';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';

class HookServerImpl {
  private server: http.Server | null = null;
  private _port: number = 0;
  private _desktopNotificationEnabled = false;

  get port(): number {
    return this._port;
  }

  setDesktopNotification(opts: { enabled: boolean }): void {
    this._desktopNotificationEnabled = opts.enabled;
  }

  private showDesktopNotification(ptyId: string, body?: string): void {
    if (!this._desktopNotificationEnabled) return;

    // Skip if the app window is focused — user is already looking at it
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.isFocused()) return;

    try {
      if (!body) {
        body = 'A task finished';
        try {
          const db = getDb();
          const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
          if (task?.name) {
            body = `${task.name} finished`;
          }
        } catch (err) {
          console.error('[HookServer] DB lookup for notification body failed:', err);
        }
      }
      const n = new Notification({
        title: 'Dash',
        body,
      });
      n.on('click', () => {
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
          win.webContents.send('app:focusTask', ptyId);
        }
      });
      n.show();
    } catch (err) {
      console.error('[HookServer] Failed to show notification:', err);
    }
  }

  private getTaskName(ptyId: string): string {
    try {
      const db = getDb();
      const task = db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, ptyId)).get();
      return task?.name || 'A task';
    } catch (err) {
      console.error('[HookServer] getTaskName failed for ptyId', ptyId, err);
      return 'A task';
    }
  }

  /** Parse a POST request body as JSON. */
  private parsePostBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          console.error(
            '[HookServer] Failed to parse POST body:',
            err,
            '| raw:',
            body.slice(0, 200),
          );
          resolve({});
        }
      });
    });
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${this._port}`);
        const ptyId = url.searchParams.get('ptyId');

        if (!ptyId) {
          res.writeHead(400);
          res.end();
          return;
        }

        // GET endpoints (legacy)
        if (req.method === 'GET') {
          if (url.pathname === '/hook/busy') {
            activityMonitor.setBusy(ptyId);
            res.writeHead(200);
            res.end('ok');
            return;
          }
        }

        // POST endpoints
        if (req.method === 'POST') {
          const payload = await this.parsePostBody(req);

          switch (url.pathname) {
            case '/hook/stop': {
              activityMonitor.setIdle(ptyId);
              this.showDesktopNotification(ptyId);
              res.writeHead(200);
              res.end('ok');
              return;
            }

            case '/hook/notification': {
              const notificationType = payload.notification_type as string;
              const message = payload.message as string | undefined;

              if (notificationType === 'permission_prompt') {
                activityMonitor.setWaitingForPermission(ptyId);
                const taskName = this.getTaskName(ptyId);
                const notifBody = message
                  ? `${taskName}: ${message}`
                  : `${taskName} needs permission`;
                this.showDesktopNotification(ptyId, notifBody);
              } else if (notificationType === 'idle_prompt') {
                activityMonitor.setIdle(ptyId);
                this.showDesktopNotification(ptyId);
              }
              res.writeHead(200);
              res.end('ok');
              return;
            }

            default:
              break;
          }
        }

        res.writeHead(404);
        res.end();
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
          console.error(`[HookServer] Listening on 127.0.0.1:${this._port}`);
          resolve(this._port);
        } else {
          reject(new Error('Failed to get hook server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this._port = 0;
    }
  }
}

export const hookServer = new HookServerImpl();
