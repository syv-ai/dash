import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PortsOnboardingWizard } from '../PortsOnboardingWizard';
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

function makeServices() {
  return {
    heuristic: vi.fn(async () => ({ signals: ['vite'], guesses: ['frontend:5173'] })),
    markDismissed: vi.fn(),
    migrate: vi.fn(async () => {}),
  };
}

let sock: FakeSocket;
let services: ReturnType<typeof makeServices>;
let onTeardown: Mock<(reason: string | null) => void>;

function makeFlow() {
  sock = new FakeSocket();
  services = makeServices();
  onTeardown = vi.fn<(reason: string | null) => void>();
  return new PortsOnboardingWizard('t1', 'p1', { socket: sock as never, onTeardown }, services);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function exitShow(s: FakeSocket) {
  return s.sent.find((m) => m.type === 'show' && m.screen === 'exit') as
    | Extract<PortsMainToTui, { type: 'show'; screen: 'exit' }>
    | undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('PortsOnboardingWizard', () => {
  it('shows ONBOARDING with heuristic results on ready', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    expect(sock.sent[0]).toMatchObject({
      type: 'show',
      screen: 'onboarding',
      props: { signals: ['vite'], guesses: ['frontend:5173'] },
    });
  });

  it('setup -> MIGRATING, migrate called with heuristic output, exit migrated', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await flush();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'migrating')).toBe(true);
    expect(services.migrate).toHaveBeenCalledWith({
      signals: ['vite'],
      guesses: ['frontend:5173'],
    });
    expect(exitShow(sock)?.props.reason).toBe('migrated');
    void flow;
  });

  it('migrate failure surfaces as error exit', async () => {
    sock = new FakeSocket();
    services = makeServices();
    services.migrate = vi.fn(async () => {
      throw new Error('git worktree add failed');
    });
    onTeardown = vi.fn<(reason: string | null) => void>();
    const failing = new PortsOnboardingWizard(
      't1',
      'p1',
      { socket: sock as never, onTeardown },
      services,
    );
    await failing.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await flush();
    expect(exitShow(sock)?.props.reason).toBe('error');
    expect(exitShow(sock)?.props.errorMessage).toContain('git worktree add failed');
  });

  it('not-now exits without dismissing', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-now' });
    await vi.advanceTimersByTimeAsync(300);
    expect(services.markDismissed).not.toHaveBeenCalled();
    expect(exitShow(sock)?.props.reason).toBe('not-now');
    expect(onTeardown).toHaveBeenCalledWith('not-now');
    void flow;
  });

  it('not-relevant dismisses and exits', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-relevant' });
    await vi.advanceTimersByTimeAsync(300);
    expect(services.markDismissed).toHaveBeenCalledOnce();
    expect(exitShow(sock)?.props.reason).toBe('not-relevant');
    void flow;
  });

  it('socket close mid-flow reports onTeardown(null)', async () => {
    const flow = makeFlow();
    await flow.start();
    sock.receive({ type: 'ready', version: 1 });
    await flush();
    sock.triggerClose();
    await vi.advanceTimersByTimeAsync(300);
    expect(onTeardown).toHaveBeenCalledWith(null);
    void flow;
  });
});
