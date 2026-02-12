import * as http from 'http';
import { Notification } from 'electron';
import { activityMonitor } from './ActivityMonitor';

class HookServerImpl {
  private server: http.Server | null = null;
  private _port: number = 0;
  private _desktopNotificationEnabled = false;
  private _desktopNotificationMessage = 'Claude finished and needs your attention';

  get port(): number {
    return this._port;
  }

  setDesktopNotification(opts: { enabled: boolean; message: string }): void {
    this._desktopNotificationEnabled = opts.enabled;
    this._desktopNotificationMessage = opts.message || 'Claude finished and needs your attention';
  }

  private showDesktopNotification(): void {
    if (!this._desktopNotificationEnabled) return;
    try {
      const n = new Notification({
        title: 'Dash',
        body: this._desktopNotificationMessage,
      });
      n.show();
    } catch (err) {
      console.error('[HookServer] Failed to show notification:', err);
    }
  }

  async start(): Promise<number> {
    if (this.server) return this._port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${this._port}`);
        const ptyId = url.searchParams.get('ptyId');

        if (req.method === 'GET' && ptyId) {
          if (url.pathname === '/hook/stop') {
            console.error(`[HookServer] Stop hook fired for ptyId=${ptyId}`);
            activityMonitor.setIdle(ptyId);
            this.showDesktopNotification();
            res.writeHead(200);
            res.end('ok');
            return;
          }
          if (url.pathname === '/hook/busy') {
            console.error(`[HookServer] Busy hook fired for ptyId=${ptyId}`);
            activityMonitor.setBusy(ptyId);
            res.writeHead(200);
            res.end('ok');
            return;
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
