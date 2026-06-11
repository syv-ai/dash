import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestrator, type FlowIo } from '../FlowOrchestrator';

type Show =
  | { type: 'show'; screen: 'main' }
  | { type: 'show'; screen: 'exit'; props: { reason: string } };
type Choice = { type: 'choice'; screen: 'main'; value: 'go' | 'quit' };

class FakeSocket {
  sent: unknown[] = [];
  private messageHandlers = new Set<(m: unknown) => void>();
  private closeHandlers = new Set<() => void>();
  async send(msg: unknown) {
    this.sent.push(msg);
  }
  async close() {}
  receive(msg: unknown) {
    for (const h of this.messageHandlers) h(msg);
  }
  triggerClose() {
    for (const h of this.closeHandlers) h();
  }
  onMessage(cb: (m: unknown) => void) {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }
  onClose(cb: () => void) {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }
}

class TestFlow extends FlowOrchestrator<Show, Choice> {
  readyCount = 0;
  choices: Choice[] = [];
  cleanupRuns = 0;

  protected override async onStart(): Promise<void> {
    this.onCleanup(() => {
      this.cleanupRuns++;
    });
  }
  protected async onReady(): Promise<void> {
    this.readyCount++;
    await this.show({ type: 'show', screen: 'main' });
    this.setTimer('test', 60_000, () => {
      void this.exit('error');
    });
  }
  protected async onChoice(msg: Choice): Promise<void> {
    this.choices.push(msg);
    if (msg.value === 'quit') await this.exit('quit');
  }
  protected exitScreen(reason: string): Show {
    return { type: 'show', screen: 'exit', props: { reason } };
  }
}

let sock: FakeSocket;
let onTeardown: ReturnType<typeof vi.fn>;
let flow: TestFlow;

function makeFlow() {
  sock = new FakeSocket();
  onTeardown = vi.fn();
  flow = new TestFlow('t1', 'p1', { socket: sock, onTeardown } as unknown as FlowIo<Show, Choice>);
  return flow;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('FlowOrchestrator lifecycle', () => {
  it('routes ready -> onReady exactly once (dup-ready guard)', async () => {
    await makeFlow().start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    expect(flow.readyCount).toBe(1);
  });

  it('routes choice messages to onChoice', async () => {
    await makeFlow().start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'main', value: 'go' });
    await flush();
    expect(flow.choices).toHaveLength(1);
  });

  it('exit() shows the exit screen then tears down with the reason', async () => {
    await makeFlow().start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'main', value: 'quit' });
    await vi.advanceTimersByTimeAsync(300); // graceful-shutdown dance
    expect(sock.sent).toContainEqual({ type: 'show', screen: 'exit', props: { reason: 'quit' } });
    expect(sock.sent).toContainEqual({ type: 'shutdown' });
    expect(onTeardown).toHaveBeenCalledWith('quit');
    expect(onTeardown).toHaveBeenCalledTimes(1);
  });

  it('socket close tears down with reason null and clears timers', async () => {
    await makeFlow().start();
    sock.receive({ type: 'ready', version: 1 }); // arms the 60s timer
    await flush();
    sock.triggerClose();
    await vi.advanceTimersByTimeAsync(300);
    expect(onTeardown).toHaveBeenCalledWith(null);
    expect(flow.cleanupRuns).toBe(1);
    // Timer was cleared: advancing past it must not fire exit('error').
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sock.sent).not.toContainEqual({
      type: 'show',
      screen: 'exit',
      props: { reason: 'error' },
    });
  });

  it('teardown is idempotent', async () => {
    await makeFlow().start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.triggerClose();
    sock.triggerClose();
    await vi.advanceTimersByTimeAsync(600);
    await flow.teardown();
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(flow.cleanupRuns).toBe(1);
  });
});
