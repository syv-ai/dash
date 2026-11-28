/**
 * Refusal of the folder rule (shared/folderSharing, DatabaseService
 * findFolderOccupant): an active task on a branch, or one joining a task on
 * a branch, already runs in the folder. Typed so the control API can answer
 * 409 rather than 500.
 */
export class FolderOccupiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderOccupiedError';
  }
}
