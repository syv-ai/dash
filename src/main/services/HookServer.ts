import * as http from 'http';
import { BrowserWindow, Notification } from 'electron';
import { eq } from 'drizzle-orm';
import { activityMonitor } from './ActivityMonitor';
import { contextUsageService } from './ContextUsageService';
import { getDb } from '../db/client';
import { tasks } from '../db/schema';

/** Maximum JSON body size for hook payloads (64KB). */
const MAX_HOOK_BODY_BYTES = 65_536;

class HookServerImpl {
  private server: http.Server | null = null;
  private _port: number = 0;
  private _desktopNotificationEnabled = false;
  // Permissive default until setPtyValidator is called during boot
  private _hasPty: (id: string) => boolean = () => true;

  get port(): number {
    return this._port;
  }

  setDesktopNotification(opts: { enabled: boolean }): void {
    this._desktopNotificationEnabled = opts.enabled;
  }

  setPtyValidator(fn: (id: string) => boolean): void {
    this._hasPty = fn;
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
          console.warn('[HookServer] DB lookup for notification body failed:', err);
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
      console.warn('[HookServer] DB lookup for task name failed:', err);
      return 'A task';
    }
  }

  /** Read and parse a JSON POST body, enforcing a size limit. */
  private readJsonBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    callback: (data: Record<string, unknown>) => void,
  ): void {
    let body = '';
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400);
        res.end();
      }
    });
    req.on('end', () => {
      if (res.headersSent) return;
      if (overflow) {
        res.writeHead(413);
        res.end('payload too large');
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        console.error('[HookServer] Failed to parse JSON body:', err);
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        res.writeHead(400);
        res.end('expected JSON object');
        return;
      }
      try {
        callback(parsed);
      } catch (err) {
        console.error('[HookServer] Callback error:', err);
        res.writeHead(500);
        res.end();
      }
    });
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
          if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return;
          }

          const url = new URL(req.url || '', `http://127.0.0.1:${this._port}`);
          const ptyId = url.searchParams.get('ptyId');

          if (!ptyId) {
            res.writeHead(400);
            res.end('missing ptyId');
            return;
          }

          if (!this._hasPty(ptyId)) {
            res.writeHead(404);
            res.end();
            return;
          }

          const pathname = url.pathname;

          // Hooks are POST — drain the JSON body before responding.
          // IMPORTANT: Response must have an empty body (not 'ok') to avoid
          // injecting text into Claude's conversation context.

          if (pathname === '/hook/stop') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setIdle(ptyId);
              this.showDesktopNotification(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/busy') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setBusy(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/notification') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const notificationType =
                typeof payload.notification_type === 'string' ? payload.notification_type : '';
              const message = typeof payload.message === 'string' ? payload.message : undefined;

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
              res.end();
            });
            return;
          }

          // StatusLine data (context usage) — uses type:"command" + curl, not type:"http"
          if (pathname === '/hook/context') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (data) => {
              contextUsageService.updateFromStatusLine(ptyId, data);
              activityMonitor.noteStatusLine(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/tool-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const toolName =
                typeof payload.tool_name === 'string' ? payload.tool_name : 'unknown';
              const toolInput =
                payload.tool_input && typeof payload.tool_input === 'object'
                  ? (payload.tool_input as Record<string, unknown>)
                  : undefined;
              activityMonitor.setToolStart(ptyId, toolName, toolInput);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/tool-end') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setToolEnd(ptyId);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/stop-failure') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, (payload) => {
              const errorType =
                typeof payload.error_type === 'string' ? payload.error_type : 'unknown';
              const message = typeof payload.error === 'string' ? payload.error : undefined;
              console.error(`[HookServer] StopFailure for ptyId=${ptyId} type=${errorType}`);
              activityMonitor.setError(ptyId, errorType, message);

              if (errorType === 'rate_limit') {
                const taskName = this.getTaskName(ptyId);
                this.showDesktopNotification(ptyId, `${taskName} hit rate limit`);
              }

              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/compact-start') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setCompacting(ptyId, true);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          if (pathname === '/hook/compact-end') {
            this.readJsonBody(req, res, MAX_HOOK_BODY_BYTES, () => {
              activityMonitor.setCompacting(ptyId, false);
              res.writeHead(200);
              res.end();
            });
            return;
          }

          res.writeHead(404);
          res.end();
        } catch (err) {
          console.error('[HookServer] Request handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
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
