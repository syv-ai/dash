import { createContext, useContext } from 'react';
import type { CommentsStore } from './useCommentsStore';

const CommentsContext = createContext<CommentsStore | null>(null);

export const CommentsProvider = CommentsContext.Provider;

/** Returns the store. Throws if used outside <CommentsProvider> — that's a
 *  programmer error (e.g. comments UI rendered without the provider above). */
export function useCommentsContext(): CommentsStore {
  const ctx = useContext(CommentsContext);
  if (!ctx) throw new Error('useCommentsContext must be used inside <CommentsProvider>');
  return ctx;
}
