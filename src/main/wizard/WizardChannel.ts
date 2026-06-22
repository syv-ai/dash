/**
 * Transport between a WizardOrchestrator and its view. Historically this was a
 * UNIX socket to a side-car TUI process; it's now an IPC bridge to a persistent
 * toast in the renderer. The orchestrator only needs these four methods, so the
 * surface can be anything that can deliver `Out` messages and surface `In` ones.
 */
export interface WizardChannel<In = unknown, Out = unknown> {
  send(msg: Out): Promise<void>;
  close(): Promise<void>;
  onMessage(cb: (m: In) => void): () => void;
  onClose(cb: () => void): () => void;
}

/**
 * IPC-backed channel: `send` pushes wizard state (show/progress/shutdown) to the
 * renderer's toast controller; the host calls `receive` when the renderer sends
 * a choice/exit back. One channel per active wizard, keyed by task in the host.
 */
export class IpcWizardChannel<In = unknown, Out = unknown> implements WizardChannel<In, Out> {
  private messageHandlers = new Set<(m: In) => void>();
  private closeHandlers = new Set<() => void>();
  private closed = false;

  constructor(private readonly deliver: (msg: Out) => void) {}

  async send(msg: Out): Promise<void> {
    if (this.closed) return;
    this.deliver(msg);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeHandlers) cb();
  }

  onMessage(cb: (m: In) => void): () => void {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onClose(cb: () => void): () => void {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }

  /** Feed a renderer-originated message (choice/exit) into the orchestrator. */
  receive(msg: In): void {
    if (this.closed) return;
    for (const cb of this.messageHandlers) cb(msg);
  }
}
