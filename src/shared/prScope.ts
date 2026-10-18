import type { PrProvider } from './types';

/** The diff-comment scope of a PR's drafts: 'pr:<provider>:<number>'. The one
 *  owner of that format; everything that builds or reads it comes here. */
export const prScope = (provider: PrProvider, number: number): string => `pr:${provider}:${number}`;

/** The PR a scope names, or null when it isn't a PR scope. */
export function parsePrScope(scope: string): { provider: PrProvider; number: number } | null {
  const m = /^pr:(github|ado):(\d+)$/.exec(scope);
  return m ? { provider: m[1] as PrProvider, number: Number(m[2]) } : null;
}

export const isPrScope = (scope: string): boolean => scope.startsWith('pr:');
