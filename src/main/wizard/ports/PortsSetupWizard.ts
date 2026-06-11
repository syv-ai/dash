import type { EventEmitter } from 'events';
import { WizardOrchestrator, type WizardIo } from '../WizardOrchestrator';
import type { PortsShow, PortsChoice, ExitReason } from '../../../shared/portsTuiProtocol';
import { portsDebug } from '../../services/PortsDebugLog';

const PORTS_JSON_TIMEOUT_MS = 30 * 60_000; // cap waiting for ports.json
const SENTINEL_TIMEOUT_MS = 20 * 60_000; // cap waiting for setup-complete

export interface SetupServices {
  /** Emits 'ports:config' and 'ports:setupComplete' with { taskId } payloads. */
  portsEvents: EventEmitter;
  /**
   * Read-only: the watcher already re-ran WorkspacePortsRuntime.setupTask
   * before emitting 'ports:config'; only the resulting count is displayed.
   */
  getPortCount(taskId: string): Promise<number>;
  restartAllForTask(taskId: string): Promise<void>;
}

/**
 * Destination-task flow, spawned by the migrate path. The agent PTY was
 * spawned with the inlined setup prompt as `claude`'s positional arg (via
 * ptyManager.setInitialPrompt), so the agent self-starts as soon as the user
 * accepts the trust gate — this flow never injects keystrokes; it just
 * listens for the watcher's events and walks the spinner screens.
 */
export class PortsSetupWizard extends WizardOrchestrator<PortsShow, PortsChoice> {
  private phase: 'pending' | 'waiting-config' | 'waiting-sentinel' | 'done' | 'restarting' =
    'pending';
  private allocatedCount = 0;

  constructor(
    taskId: string,
    projectId: string,
    io: WizardIo<PortsShow, PortsChoice>,
    private readonly services: SetupServices,
  ) {
    super(taskId, projectId, io);
  }

  protected override async onStart(): Promise<void> {
    const onConfig = (p: { taskId: string }) => {
      portsDebug.log('orch', 'heard ports:config', {
        payloadTaskId: p.taskId,
        wanted: this.taskId,
        phase: this.phase,
      });
      if (p.taskId === this.taskId) void this.onPortsConfig();
    };
    const onComplete = (p: { taskId: string }) => {
      portsDebug.log('orch', 'heard ports:setupComplete', {
        payloadTaskId: p.taskId,
        wanted: this.taskId,
        phase: this.phase,
      });
      if (p.taskId === this.taskId) void this.onSetupComplete();
    };
    const onConfigError = (p: { taskId: string; errors: string[] }) => {
      portsDebug.log('orch', 'heard ports:configError', {
        payloadTaskId: p.taskId,
        wanted: this.taskId,
        phase: this.phase,
      });
      if (p.taskId === this.taskId) void this.onConfigError(p.errors);
    };
    this.services.portsEvents.on('ports:config', onConfig);
    this.services.portsEvents.on('ports:configError', onConfigError);
    this.services.portsEvents.on('ports:setupComplete', onComplete);
    this.onCleanup(() => this.services.portsEvents.off('ports:config', onConfig));
    this.onCleanup(() => this.services.portsEvents.off('ports:configError', onConfigError));
    this.onCleanup(() => this.services.portsEvents.off('ports:setupComplete', onComplete));
  }

  protected async onReady(): Promise<void> {
    this.phase = 'waiting-config';
    await this.show({ type: 'show', screen: 'waiting-ports-json' });
    this.setTimer('ports-json', PORTS_JSON_TIMEOUT_MS, () => {
      void this.exit('error', "Agent didn't write ports.json within 30 minutes.");
    });
  }

  private async onPortsConfig(): Promise<void> {
    if (this.phase !== 'waiting-config') return;
    this.clearTimer('ports-json');
    this.allocatedCount = await this.services.getPortCount(this.taskId);
    this.phase = 'waiting-sentinel';
    await this.show({
      type: 'show',
      screen: 'allocated-waiting-sentinel',
      props: { count: this.allocatedCount },
    });
    // Fallback: the agent keeps working (docs, wiring, AskUserQuestion rounds)
    // for minutes after ports.json appears. If the sentinel never lands,
    // skip to DONE with the allocation we have.
    this.setTimer('sentinel', SENTINEL_TIMEOUT_MS, () => {
      void this.showDone();
    });
  }

  private async onSetupComplete(): Promise<void> {
    if (this.phase !== 'waiting-sentinel') return;
    this.clearTimer('sentinel');
    await this.showDone();
  }

  /**
   * The agent wrote a malformed/invalid ports.json. Show the validation errors
   * and stay in waiting-config (and on the 30-min cap) — a corrected rewrite
   * fires 'ports:config' and advances us. Once past waiting-config the
   * allocation already landed, so a later bad edit is the user's problem.
   */
  private async onConfigError(errors: string[]): Promise<void> {
    if (this.phase !== 'waiting-config') return;
    await this.show({ type: 'show', screen: 'config-invalid', props: { errors } });
  }

  private async showDone(): Promise<void> {
    this.phase = 'done';
    await this.show({ type: 'show', screen: 'done', props: { count: this.allocatedCount } });
  }

  protected async onChoice(m: PortsChoice): Promise<void> {
    if (m.screen !== 'done') return;
    if (m.value === 'restart') {
      this.phase = 'restarting';
      await this.show({ type: 'show', screen: 'restarting' });
      this.setTimer('restart', 500, () => {
        void (async () => {
          await this.services.restartAllForTask(this.taskId);
          await this.teardown();
        })();
      });
    } else {
      await this.exit('later');
    }
  }

  protected exitScreen(reason: string, errorMessage?: string): PortsShow {
    return { type: 'show', screen: 'exit', props: { reason: reason as ExitReason, errorMessage } };
  }
}
