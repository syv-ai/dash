import { useCommentsStore } from '../../../stores/commentsStore';
import { typeIntoTask } from '../../../utils/typeIntoTask';
import { buildCommentPrompt, type BuildPromptArgs } from '../../../utils/agentPrompt';

/** The open file, when there is one: its comments sort first and may carry
 *  a code excerpt from its live model. */
export type PromptContext = Pick<
  BuildPromptArgs,
  'currentFilePath' | 'currentScope' | 'currentFile'
>;

/** The prompt for the loaded task's comments `ids`, or null when none of them exist. */
export function commentsPrompt(ids: ReadonlyArray<string>, context?: PromptContext): string | null {
  return buildCommentPrompt({
    ids,
    byFile: useCommentsStore.getState().byFile,
    currentFilePath: context?.currentFilePath ?? '',
    currentScope: context?.currentScope ?? '',
    currentFile: context?.currentFile,
  });
}

/** Type `text` into the task's prompt, unsent; mark `ids` sent once it got there. */
export async function sendPrompt(
  taskId: string,
  text: string,
  ids: ReadonlyArray<string>,
): Promise<boolean> {
  const typed = await typeIntoTask(taskId, text);
  if (typed) useCommentsStore.getState().markSent(ids);
  return typed;
}

/** Build the prompt for comments `ids` and type it into the task: the one way
 *  notes reach the agent (the editor's menus and the Notes tray). */
export async function sendComments(
  taskId: string,
  ids: ReadonlyArray<string>,
  context?: PromptContext,
): Promise<boolean> {
  const text = commentsPrompt(ids, context);
  return text !== null && sendPrompt(taskId, text, ids);
}
