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
        } catch {
          // DB lookup failed — use fallback
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
    } catch {
      return 'A task';
    }
  }

  /** Broadcast an IPC event to the renderer that owns this ptyId. */
  private sendToRenderers(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  /** Parse a POST request body as JSON. */
  private parsePostBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
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

        // All POST endpoints
        if (req.method === 'POST') {
          const payload = await this.parsePostBody(req);

          switch (url.pathname) {
            // ── Stop ──────────────────────────────────────────
            case '/hook/stop': {
              activityMonitor.setIdle(ptyId);
              this.showDesktopNotification(ptyId);
              this.sendToRenderers(`hook:stop:${ptyId}`, {
                lastAssistantMessage: payload.last_assistant_message || null,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── StopFailure ───────────────────────────────────
            case '/hook/stop-failure': {
              activityMonitor.setIdle(ptyId);
              this.sendToRenderers(`hook:stopFailure:${ptyId}`, {
                error: payload.error || 'unknown',
                errorDetails: payload.error_details || '',
                lastAssistantMessage: payload.last_assistant_message || '',
              });
              const taskName = this.getTaskName(ptyId);
              this.showDesktopNotification(ptyId, `${taskName}: API error (${payload.error})`);
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── PreToolUse ────────────────────────────────────
            case '/hook/pre-tool-use': {
              this.sendToRenderers(`hook:preToolUse:${ptyId}`, {
                toolName: payload.tool_name,
                toolInput: payload.tool_input,
                toolUseId: payload.tool_use_id,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── PostToolUse ───────────────────────────────────
            case '/hook/post-tool-use': {
              this.sendToRenderers(`hook:postToolUse:${ptyId}`, {
                toolName: payload.tool_name,
                toolInput: payload.tool_input,
                toolResponse: payload.tool_response,
                toolUseId: payload.tool_use_id,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── PostToolUseFailure ────────────────────────────
            case '/hook/post-tool-use-failure': {
              this.sendToRenderers(`hook:postToolUseFailure:${ptyId}`, {
                toolName: payload.tool_name,
                toolInput: payload.tool_input,
                toolUseId: payload.tool_use_id,
                error: payload.error,
                isInterrupt: payload.is_interrupt || false,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── SubagentStart ─────────────────────────────────
            case '/hook/subagent-start': {
              this.sendToRenderers(`hook:subagentStart:${ptyId}`, {
                agentId: payload.agent_id,
                agentType: payload.agent_type,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── SubagentStop ──────────────────────────────────
            case '/hook/subagent-stop': {
              this.sendToRenderers(`hook:subagentStop:${ptyId}`, {
                agentId: payload.agent_id,
                agentType: payload.agent_type,
                agentTranscriptPath: payload.agent_transcript_path || null,
                lastAssistantMessage: payload.last_assistant_message || null,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── SessionStart ──────────────────────────────────
            case '/hook/session-start': {
              this.sendToRenderers(`hook:sessionStart:${ptyId}`, {
                sessionId: payload.session_id,
                source: payload.source,
                transcriptPath: payload.transcript_path,
              });
              res.writeHead(200);
              res.end('ok');
              return;
            }

            // ── Notification ──────────────────────────────────
            case '/hook/notification': {
              const notificationType: string = payload.notification_type;
              const message: string | undefined = payload.message;

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

              this.sendToRenderers(`hook:notification:${ptyId}`, {
                notificationType,
                message: message || '',
                title: payload.title || '',
              });
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
