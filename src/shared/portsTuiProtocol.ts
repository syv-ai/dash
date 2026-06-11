export type TuiScreen =
  | 'onboarding'
  | 'migrating'
  | 'waiting-ports-json'
  | 'allocated-waiting-sentinel'
  | 'done'
  | 'restarting'
  | 'exit';

export type ExitReason = 'not-now' | 'not-relevant' | 'later' | 'migrated' | 'error';

export type MainToTui =
  | { type: 'show'; screen: 'onboarding'; props: { signals: string[]; guesses: string[] } }
  | { type: 'show'; screen: 'migrating'; props: { newTaskName: string; branchName: string } }
  | { type: 'show'; screen: 'waiting-ports-json' }
  | { type: 'show'; screen: 'allocated-waiting-sentinel'; props: { count: number } }
  | { type: 'show'; screen: 'done'; props: { count: number } }
  | { type: 'show'; screen: 'restarting' }
  | { type: 'show'; screen: 'exit'; props: { reason: ExitReason; errorMessage?: string } }
  | { type: 'progress'; text: string }
  | { type: 'shutdown' };

export type TuiToMain =
  | { type: 'ready'; version: number }
  | { type: 'choice'; screen: 'onboarding'; value: 'setup' | 'not-now' | 'not-relevant' }
  | { type: 'choice'; screen: 'done'; value: 'restart' | 'later' }
  | { type: 'exit'; reason: 'user' | 'shutdown-ack' | 'error' }
  | { type: 'error'; message: string };

export const TUI_PROTOCOL_VERSION = 1;
