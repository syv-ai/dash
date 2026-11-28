import type { ForgeCapabilities, PrProvider } from './types';
import { GITHUB_REACTIONS } from './prReactions';
import { providerForRemote } from './urls';

/** Each forge's capabilities: the one table that says how the forges differ
 *  where the shared model can't hide it. */
export const FORGE_CAPABILITIES: Record<PrProvider, ForgeCapabilities> = {
  github: { reactions: GITHUB_REACTIONS, generalReply: 'quote', linkedItems: 'issues' },
  ado: { reactions: ['LIKE'], generalReply: 'thread', linkedItems: 'workItems' },
};

/** The capabilities of the forge a remote is on; null for a forge Dash doesn't support. */
export function forgeCapabilitiesFor(remote: string | null): ForgeCapabilities | null {
  const provider = providerForRemote(remote);
  return provider ? FORGE_CAPABILITIES[provider] : null;
}
