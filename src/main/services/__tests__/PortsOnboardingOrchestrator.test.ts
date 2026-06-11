import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PortsOnboardingOrchestrator } from '../PortsOnboardingOrchestrator';
import type {
  PortsMainToTui as MainToTui,
  PortsTuiToMain as TuiToMain,
} from '../../../shared/portsTuiProtocol';

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
    runtime: { getPortCount: vi.fn(async () => 8) },
    configWatcher: {
      events: new EventEmitter(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    },
    sessionRegistry: { restartAllForTask: vi.fn(async () => {}) },
    drawerTabs: {
      add: vi.fn(() => ({ id: 'ports-tui:t1' })),
      close: vi.fn(),
    },
    dismissStore: {
      isDismissed: vi.fn(() => false),
      markDismissed: vi.fn(),
    },
    migrate: vi.fn(async () => {}),
    onTeardown: vi.fn(),
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

/**
 * Flush microtasks without firing any pending fake timers. Used for tests that
 * arm the 30-min waiting-ports-json poll-timeout in onReady; vi.runAllTimers
 * would fire the timeout itself and tear the orchestrator down before assertions.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
    await flushMicrotasks();
    expect(sock.sent[0]).toMatchObject({ type: 'show', screen: 'onboarding' });
  });

  it('ONBOARDING + not-now -> EXIT without dismiss', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-now' });
    await flushMicrotasks();
    expect(services.dismissStore.markDismissed).not.toHaveBeenCalled();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'exit')).toBe(true);
  });

  it('ONBOARDING + not-relevant -> EXIT and persists dismiss', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-relevant' });
    await flushMicrotasks();
    expect(services.dismissStore.markDismissed).toHaveBeenCalledWith('p1');
  });

  it('ONBOARDING + setup -> emits MIGRATING, calls migrate, exits with reason=migrated', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await flushMicrotasks();

    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'migrating')).toBe(true);
    expect(services.migrate).toHaveBeenCalledWith({
      signals: ['vite'],
      guesses: ['frontend:5173'],
    });
    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit');
    expect(exit).toBeDefined();
    expect((exit as Extract<MainToTui, { type: 'show'; screen: 'exit' }>).props.reason).toBe(
      'migrated',
    );
  });

  it('ONBOARDING + setup -> migrate failure surfaces as error exit', async () => {
    services.migrate = vi.fn(async () => {
      throw new Error('git worktree add failed');
    });
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'setup' });
    await flushMicrotasks();

    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit');
    expect(exit).toBeDefined();
    const props = (exit as Extract<MainToTui, { type: 'show'; screen: 'exit' }>).props;
    expect(props.reason).toBe('error');
    expect(props.errorMessage).toContain('git worktree add failed');
  });

  it('TUI close mid-flow tears down state and does not throw', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    orch.setTabId('ports-tui:t1');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.triggerClose();
    // teardown() now sends a graceful 'shutdown' to the side-car and waits
    // ~200ms before yanking the socket — advance fake timers past that
    // delay so drawerTabs.close() actually runs.
    await vi.advanceTimersByTimeAsync(300);
    expect(services.drawerTabs.close).toHaveBeenCalled();
  });

  it('initialState=launching emits WAITING_PORTS_JSON immediately (agent PTY pre-loaded with prompt)', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    // Migrate path: the new task's `claude` was spawned with the inlined
    // setup prompt as its positional argument (see ptyManager.setInitialPrompt
    // + portsTuiIpc.handleMigrate). CC auto-submits once trust clears, so
    // the orchestrator never injects keystrokes — it just waits for ports.json.
    expect(sock.sent[0]).toMatchObject({ type: 'show', screen: 'waiting-ports-json' });
  });

  it('initialState=launching transitions to ALLOCATED on ports:config', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:config', { taskId: 't1' });
    await flushMicrotasks();
    expect(
      sock.sent.some((m) => m.type === 'show' && m.screen === 'allocated-waiting-sentinel'),
    ).toBe(true);
    // The watcher already ran WorkspacePortsRuntime.setupTask before emitting
    // ports:config — the orchestrator only reads the resulting count.
    expect(services.runtime.getPortCount).toHaveBeenCalledWith('t1');
  });

  it('ONBOARDING + not-now exits with reason not-now', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-now' });
    await flushMicrotasks();
    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit');
    expect(exit).toBeDefined();
    expect((exit as Extract<MainToTui, { type: 'show'; screen: 'exit' }>).props.reason).toBe(
      'not-now',
    );
  });

  it('duplicate ready after leaving pending-ready is ignored', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:config', { taskId: 't1' });
    await flushMicrotasks();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    // A second 'ready' must not reset the flow back to waiting-ports-json.
    const waitingShows = sock.sent.filter(
      (m) => m.type === 'show' && m.screen === 'waiting-ports-json',
    );
    expect(waitingShows).toHaveLength(1);
    // The sentinel path must still complete normally afterwards.
    services.configWatcher.events.emit('ports:setupComplete', { taskId: 't1' });
    await flushMicrotasks();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(true);
  });

  it('teardown reports the exit reason via onTeardown', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'onboarding', value: 'not-now' });
    await vi.advanceTimersByTimeAsync(300);
    expect(services.onTeardown).toHaveBeenCalledWith('not-now');
  });

  it('socket close mid-flow reports onTeardown(null)', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock);
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    sock.triggerClose();
    await vi.advanceTimersByTimeAsync(300);
    expect(services.onTeardown).toHaveBeenCalledWith(null);
  });

  it('ALLOCATED receives setupComplete event -> DONE', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:config', { taskId: 't1' });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:setupComplete', { taskId: 't1' });
    await flushMicrotasks();
    expect(sock.sent.some((m) => m.type === 'show' && m.screen === 'done')).toBe(true);
  });

  it('DONE + restart -> RESTARTING and calls sessionRegistry', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:config', { taskId: 't1' });
    await flushMicrotasks();
    services.configWatcher.events.emit('ports:setupComplete', { taskId: 't1' });
    await flushMicrotasks();
    sock.receive({ type: 'choice', screen: 'done', value: 'restart' });
    await vi.advanceTimersByTimeAsync(600);
    expect(services.sessionRegistry.restartAllForTask).toHaveBeenCalledWith('t1');
  });

  it('30-min cap on WAITING_FOR_PORTS_JSON exits with error reason', async () => {
    const sock = new FakeSocket();
    const orch = makeOrchestrator(sock, 'launching');
    await orch.start();
    sock.receive({ type: 'ready', version: 1 });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
    const exit = sock.sent.find((m) => m.type === 'show' && m.screen === 'exit');
    expect(exit).toBeDefined();
    expect((exit as Extract<MainToTui, { type: 'show'; screen: 'exit' }>).props.reason).toBe(
      'error',
    );
  });
});
