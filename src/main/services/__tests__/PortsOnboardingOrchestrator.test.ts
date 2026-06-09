import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PortsOnboardingOrchestrator } from '../PortsOnboardingOrchestrator';
import type { MainToTui, TuiToMain } from '../../../shared/portsTuiProtocol';

class FakeSocket {
  sent: MainToTui[] = [];
  private messageHandlers = new Set<(m: TuiToMain) => void>();
  private closeHandlers = new Set<() => void>();
  async send(msg: MainToTui) {
    this.sent.push(msg);
  }
  async listen() {
    /* noop */
  }
  async close() {
    /* noop */
  }
  receive(msg: TuiToMain) {
    for (const h of this.messageHandlers) h(msg);
  }
  onMessage(cb: (m: TuiToMain) => void) {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }
  onClose(cb: () => void) {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }
  onError() {
    return () => {};
  }
  triggerClose() {
    for (const h of this.closeHandlers) h();
  }
}

function makeServices() {
  return {
    heuristic: {
      run: vi.fn(async () => ({ signals: ['vite'], guesses: ['frontend:5173'] })),
    },
    installer: { install: vi.fn(async () => {}) },
    runtime: { setupTask: vi.fn(async () => ({ count: 8 })) },
    configWatcher: new EventEmitter(),
    sessionRegistry: { restartAllForTask: vi.fn(async () => {}) },
    drawerTabs: {
      add: vi.fn(() => ({ id: 'ports-tui:t1' })),
      close: vi.fn(),
    },
    dismissStore: {
      isDismissed: vi.fn(() => false),
      markDismissed: vi.fn(),
    },
    agentSender: { sendKeys: vi.fn(async () => {}) },
  };
}

let services: ReturnType<typeof makeServices>;

function makeOrchestrator(
  socket: FakeSocket,
  initialState: 'onboarding' | 'launching' = 'onboarding',
) {
  return new PortsOnboardingOrchestrator({
    taskId: 't1',
    projectId: 'p1',
    taskName: 'My task',
    projectName: 'acme',
    initialState,
    socket: socket as never,
    services: services as never,
  });
}

beforeEach(() => {
  services = makeServices();
  vi.useFakeTimers();
});

describe('PortsOnboardingOrchestrator transitions', () => {
  it('emits ONBOARDING on ready', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    expect(sock.sent[0]).toMatchObject({ type: 'show', screen: 'onboarding' });
  });

  it('ONBOARDING + setup -> DESCRIBE', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    expect(sock.sent.find((m) => m.type === 'show' && m.screen === 'describe')).toBeDefined();
  });

  it('ONBOARDING + not-now -> EXIT without dismiss', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-now' });
    await vi.runAllTimersAsync();
    expect(services.dismissStore.markDismissed).not.toHaveBeenCalled();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'exit')).toBe(true);
  });

  it('ONBOARDING + not-relevant -> EXIT and persists dismiss', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-relevant' });
    await vi.runAllTimersAsync();
    expect(services.dismissStore.markDismissed).toHaveBeenCalledWith('p1');
  });

  it('DESCRIBE + proceed -> CHOOSE_TASK', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'choose-task')).toBe(true);
  });

  it('CHOOSE_TASK + current -> LAUNCHING (skips MIGRATING)', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.runAllTimersAsync();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'launching')).toBe(true);
    expect(services.installer.install).toHaveBeenCalled();
    expect(services.agentSender.sendKeys).toHaveBeenCalled();
  });

  it('LAUNCHING -> WAITING_FOR_PORTS_JSON', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'waiting-ports-json')).toBe(
      true,
    );
  });

  it('WAITING_FOR_PORTS_JSON receives portsConfig event -> ALLOCATED', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    services.configWatcher.emit('ports:config', { taskId: 't1' });
    await vi.runAllTimersAsync();
    expect(
      sock.sent.some((m) => m.type === 'show' && m.screen === 'allocated-waiting-sentinel'),
    ).toBe(true);
    expect(services.runtime.setupTask).toHaveBeenCalledWith('t1');
  });

  it('ALLOCATED receives setupComplete event -> DONE', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    services.configWatcher.emit('ports:config', { taskId: 't1' });
    await vi.runAllTimersAsync();
    services.configWatcher.emit('ports:setupComplete', { taskId: 't1' });
    await vi.runAllTimersAsync();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(true);
  });

  it('DONE + restart -> RESTARTING and calls sessionRegistry', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    services.configWatcher.emit('ports:config', { taskId: 't1' });
    await vi.runAllTimersAsync();
    services.configWatcher.emit('ports:setupComplete', { taskId: 't1' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'done', value: 'restart' });
    await vi.advanceTimersByTimeAsync(600);
    expect(services.sessionRegistry.restartAllForTask).toHaveBeenCalledWith('t1');
  });

  it('30-min cap on WAITING_FOR_PORTS_JSON exits with error reason', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit');
    expect(exit).toBeDefined();
    expect((exit as Extract<MainToTui, { type: 'show'; screen: 'exit' }>).props.reason).toBe(
      'error',
    );
  });

  it('TUI close mid-flow tears down state and does not throw', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    orch.setTabId('ports-tui:t1');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.triggerClose();
    await vi.runAllTimersAsync();
    expect(services.drawerTabs.close).toHaveBeenCalled();
  });

  it('captures taskId at start; installer is invoked with locked taskId', async () => {
    // Invariant: orchestrator's taskId is locked at TUI spawn, never read live.
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'describe', value: 'proceed' });
    await vi.runAllTimersAsync();
    sock.receive({ type: 'choice', screen: 'choose-task', value: 'current' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(services.installer.install).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1' }),
    );
  });
});
