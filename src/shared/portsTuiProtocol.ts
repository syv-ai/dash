import type { MainToTui, TuiToMain } from './tuiProtocol';

export type ExitReason = 'not-now' | 'not-relevant' | 'later' | 'migrated' | 'error';

export type PortsShow =
  | { type: 'show'; screen: 'onboarding'; props: { signals: string[]; guesses: string[] } }
  | { type: 'show'; screen: 'migrating'; props: { newTaskName: string; branchName: string } }
  | { type: 'show'; screen: 'waiting-ports-json' }
  | { type: 'show'; screen: 'config-invalid'; props: { errors: string[] } }
  | { type: 'show'; screen: 'done'; props: { count: number } }
  | { type: 'show'; screen: 'restarting' }
  | { type: 'show'; screen: 'exit'; props: { reason: ExitReason; errorMessage?: string } };

export type PortsChoice =
  | { type: 'choice'; screen: 'onboarding'; value: 'setup' | 'not-now' | 'not-relevant' }
  | { type: 'choice'; screen: 'done'; value: 'restart' | 'later' };

export type PortsMainToTui = MainToTui<PortsShow>;
export type PortsTuiToMain = TuiToMain<PortsChoice>;
