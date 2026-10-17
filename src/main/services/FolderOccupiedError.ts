/**
 * Refusal of the one-in-place-task-per-folder rule (DatabaseService
 * findActiveNonWorktreeTaskAt): another active task already runs in the
 * folder. Typed so the control API can answer 409 rather than 500.
 */
export class FolderOccupiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderOccupiedError';
  }
}
