import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { PortsSetupWizard } from '../PortsSetupWizard';
import type { PortsMainToTui } from '../../../../shared/portsTuiProtocol';

class FakeSocket {
  sent: PortsMainToTui[] = [];
  private messageHandlers = new Set<(m: unknown) => void>();
  private closeHandlers = new Set<() => void>();
  async send(msg: PortsMainToTui) {
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

let sock: FakeSocket;
let portsEvents: EventEmitter;
let services: ReturnType<typeof makeServices>;
let onTeardown: Mock<(reason: string | null) => void>;

function makeServices() {
  portsEvents = new EventEmitter();
  return {
    portsEvents,
    getPortCount: vi.fn(async () => 8),
    restartAllForTask: vi.fn(async () => {}),
  };
}

function makeFlow() {
  sock = new FakeSocket();
  services = makeServices();
  onTeardown = vi.fn<(reason: string | null) => void>();
  return new PortsSetupWizard('t1', 'p1', { socket: sock as never, onTeardown }, services);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function readyAndConfig(flow: PortsSetupWizard) {
  await flow.start();
  sock.receive({ type: 'ready', version: 1 });
  await flush();
  portsEvents.emit('ports:config', { taskId: 't1' });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('PortsSetupWizard', () => {
  it('shows WAITING_PORTS_JSON on ready', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    expect(sock.sent[0]).toMatchObject({ type: 'show', screen: 'waiting-ports-json' });
    void flow;
  });

  it('ignores ports:config for other tasks', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    portsEvents.emit('ports:config', { taskId: 'other' });
    await flush();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(false);
    void flow;
  });

  it('ports:config -> DONE with count', async () => {
    const flow = makeFlow();
    await readyAndConfig(flow);
    expect(
      sock.sent.some((m) => m.type === 'show' && m.screen === 'done' && m.props.count === 8),
    ).toBe(true);
    expect(services.getPortCount).toHaveBeenCalledWith('t1');
  });

  it('ports:configError -> CONFIG_INVALID with the errors, no advance', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    portsEvents.emit('ports:configError', {
      taskId: 't1',
      errors: ['ports[0].envVar must match /^[A-Z_]/'],
    });
    await flush();
    const invalid = sock.sent.find((m) => m.type === 'show' && m.screen === 'config-invalid') as
      | Extract<PortsMainToTui, { type: 'show'; screen: 'config-invalid' }>
      | undefined;
    expect(invalid?.props.errors).toEqual(['ports[0].envVar must match /^[A-Z_]/']);
    // Did NOT advance past waiting-config.
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(false);
    void flow;
  });

  it('config-invalid is recoverable: a corrected ports:config still advances', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    portsEvents.emit('ports:configError', { taskId: 't1', errors: ['bad'] });
    await flush();
    portsEvents.emit('ports:config', { taskId: 't1' });
    await flush();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(true);
    void flow;
  });

  it('ignores ports:configError for other tasks', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    portsEvents.emit('ports:configError', { taskId: 'other', errors: ['bad'] });
    await flush();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'config-invalid')).toBe(false);
    void flow;
  });

  it('ports:config before ready is ignored (pending gate)', async () => {
    const flow = makeFlow();
    await flow.start();
    portsEvents.emit('ports:config', { taskId: 't1' });
    await flush();
    expect(sock.sent).toHaveLength(0);
    void flow;
  });

  it('duplicate ready mid-flow does not reset to waiting-ports-json', async () => {
    const flow = makeFlow();
    await readyAndConfig(flow);
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    const waitingShows = sock.sent.filter(
      (m) => m.type === 'show' && m.screen === 'waiting-ports-json',
    );
    expect(waitingShows).toHaveLength(1);
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(true);
    void flow;
  });

  it('30-min cap on waiting exits with error', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit') as
      | Extract<PortsMainToTui, { type: 'show'; screen: 'exit' }>
      | undefined;
    expect(exit?.props.reason).toBe('error');
    void flow;
  });

  it('DONE + restart -> RESTARTING, restarts sessions, tears down with null reason', async () => {
    const flow = makeFlow();
    await readyAndConfig(flow);
    sock.receive({ type: 'choice', screen: 'done', value: 'restart' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'restarting')).toBe(true);
    expect(services.restartAllForTask).toHaveBeenCalledWith('t1');
    expect(onTeardown).toHaveBeenCalledWith(null);
    void flow;
  });

  it('DONE + later exits with later', async () => {
    const flow = makeFlow();
    await readyAndConfig(flow);
    sock.receive({ type: 'choice', screen: 'done', value: 'later' });
    await vi.advanceTimersByTimeAsync(300);
    expect(onTeardown).toHaveBeenCalledWith('later');
    void flow;
  });

  it('teardown unsubscribes from ports events', async () => {
    const flow = makeFlow();
    await readyAndConfig(flow);
    sock.triggerClose();
    await vi.advanceTimersByTimeAsync(300);
    expect(portsEvents.listenerCount('ports:config')).toBe(0);
    expect(portsEvents.listenerCount('ports:configError')).toBe(0);
    void flow;
  });
});
