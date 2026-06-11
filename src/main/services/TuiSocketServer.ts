import net from 'net';
import fs from 'fs';
import path from 'path';

type ErrorHandler = (e: Error) => void;
type CloseHandler = () => void;

/**
 * Per-spawn UNIX socket server for talking to a side-car TUI process. Wire
 * format is newline-delimited JSON in BOTH directions — the stdout pipe carries
 * Clack visuals separately and is never shared with the protocol.
 *
 * `In` is what the side-car sends us; `Out` is what we send it.
 */
export class TuiSocketServer<In = unknown, Out = unknown> {
  private server: net.Server | null = null;
  private client: net.Socket | null = null;
  private buffer = '';
  private messageHandlers = new Set<(m: In) => void>();
  private errorHandlers = new Set<ErrorHandler>();
  private closeHandlers = new Set<CloseHandler>();

  constructor(private socketPath: string) {}

  async listen(): Promise<void> {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true });
    // Orphan socket files are common after a crash; bind would fail with
    // EADDRINUSE otherwise.
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* not present */
    }

    this.server = net.createServer((socket) => {
      this.client = socket;
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => this.onData(chunk as unknown as string));
      socket.on('close', () => {
        this.client = null;
        for (const h of this.closeHandlers) h();
      });
      socket.on('error', (err) => {
        for (const h of this.errorHandlers) h(err);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
  }

  async send(msg: Out): Promise<void> {
    if (!this.client) throw new Error('No client connected');
    const line = JSON.stringify(msg) + '\n';
    await new Promise<void>((resolve, reject) => {
      this.client!.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  onMessage(cb: (m: In) => void): () => void {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onError(cb: ErrorHandler): () => void {
    this.errorHandlers.add(cb);
    return () => this.errorHandlers.delete(cb);
  }

  onClose(cb: CloseHandler): () => void {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }

  async close(): Promise<void> {
    this.client?.end();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!;
    for (const line of lines) {
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as In;
        for (const h of this.messageHandlers) h(msg);
      } catch (err) {
        for (const h of this.errorHandlers) {
          h(new Error(`malformed JSON: ${(err as Error).message}`));
        }
      }
    }
  }
}
