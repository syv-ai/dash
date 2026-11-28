/** How a list of task names reads in a sentence: `"A"`, or `"A" and 2 more`. */
function named(names: readonly string[]): string {
  const first = `"${names[0]}"`;
  return names.length === 1 ? first : `${first} and ${names.length - 1} more`;
}

/**
 * The new-task dialog's caution for a folder where tasks already work
 * (folderSharing: tasks with no branch share one); null when none do.
 */
export function sharedFolderWarning(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const who =
    names.length === 1 ? `${named(names)} already works` : `${names.length} tasks already work`;
  return `${who} in this folder. Tasks here edit the same files, so their changes can collide.`;
}

/** The sidebar mark's tooltip on a task whose folder others share; null when none do. */
export function sharedFolderTooltip(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `Shares its folder with ${named(names)}: their changes can collide`;
}
