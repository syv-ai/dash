/**
 * Whether the PR's head as last detected for the task (its badge's lookup,
 * refetched as HEAD moves, D97) has moved past the head the review was loaded
 * at: a push landed, so the review should reload now rather than at its next
 * 60 s refresh (D96). Not while either is unknown.
 */
export const headMovedPast = (
  detected: string | undefined,
  loaded: string | null | undefined,
): boolean => !!detected && !!loaded && detected !== loaded;
