import { WizardOrchestrator, type WizardIo } from '../WizardOrchestrator';
import type { PortsShow, PortsChoice, ExitReason } from '../../../shared/portsTuiProtocol';

export interface OnboardingServices {
  heuristic(): Promise<{ signals: string[]; guesses: string[] }>;
  markDismissed(): void;
  /**
   * Hand-off to the ports feature when the user picks "Set it up": create a
   * fresh 'port-setup' worktree task, stash the inlined setup prompt for the
   * new agent PTY, switch the renderer's active task, and spawn a
   * PortsSetupWizard TUI in the new task's drawer. Resolves once the new TUI
   * is spawned; this flow then exits with 'migrated'.
   */
  migrate(opts: { signals: string[]; guesses: string[] }): Promise<void>;
}

/** Source-task flow: offer ports setup, dispatch to migrate or dismiss. */
export class PortsOnboardingWizard extends WizardOrchestrator<PortsShow, PortsChoice> {
  private signals: string[] = [];
  private guesses: string[] = [];

  constructor(
    taskId: string,
    projectId: string,
    io: WizardIo<PortsShow, PortsChoice>,
    private readonly services: OnboardingServices,
  ) {
    super(taskId, projectId, io);
  }

  protected override async onStart(): Promise<void> {
    const { signals, guesses } = await this.services.heuristic();
    this.signals = signals;
    this.guesses = guesses;
  }

  protected async onReady(): Promise<void> {
    await this.show({
      type: 'show',
      screen: 'onboarding',
      props: { signals: this.signals, guesses: this.guesses },
    });
  }

  protected async onChoice(m: PortsChoice): Promise<void> {
    if (m.screen !== 'onboarding') return;
    if (m.value === 'setup') {
      await this.show({
        type: 'show',
        screen: 'migrating',
        props: { newTaskName: 'port-setup', branchName: 'dash/port-setup' },
      });
      try {
        await this.services.migrate({ signals: this.signals, guesses: this.guesses });
        await this.exit('migrated');
      } catch (err) {
        await this.exit(
          'error',
          `Couldn't create port-setup task: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (m.value === 'not-now') {
      await this.exit('not-now');
    } else {
      this.services.markDismissed();
      await this.exit('not-relevant');
    }
  }

  protected exitScreen(reason: string, errorMessage?: string): PortsShow {
    return { type: 'show', screen: 'exit', props: { reason: reason as ExitReason, errorMessage } };
  }
}
