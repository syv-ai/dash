/** Format a human-readable status string from a tool_use block. */
export function formatToolStatus(name: string, input: Record<string, unknown>): string {
  const fileName = (p: string) => p.split('/').pop() || p;
  switch (name) {
    case 'Read':
      return input?.file_path ? `Reading ${fileName(input.file_path as string)}` : 'Reading';
    case 'Edit':
      return input?.file_path ? `Editing ${fileName(input.file_path as string)}` : 'Editing';
    case 'Write':
      return input?.file_path ? `Writing ${fileName(input.file_path as string)}` : 'Writing';
    case 'Bash':
      return input?.command
        ? `Running \`${(input.command as string).slice(0, 60)}\``
        : 'Running command';
    case 'Glob':
      return input?.pattern ? `Searching for ${input.pattern}` : 'Searching files';
    case 'Grep':
      return input?.pattern ? `Searching for "${input.pattern}"` : 'Searching content';
    case 'Agent':
      return (input?.description as string) || 'Running subagent';
    case 'WebFetch':
      return input?.url ? `Fetching ${(input.url as string).slice(0, 50)}` : 'Fetching web page';
    case 'WebSearch':
      return input?.query ? `Searching "${(input.query as string).slice(0, 50)}"` : 'Searching web';
    case 'TaskCreate':
      return input?.subject
        ? `Creating task: ${(input.subject as string).slice(0, 50)}`
        : 'Creating task';
    case 'TaskUpdate':
      return input?.status ? `Updating task #${input.taskId} → ${input.status}` : 'Updating task';
    case 'ToolSearch':
      return input?.query
        ? `Searching tools: "${(input.query as string).slice(0, 50)}"`
        : 'Searching tools';
    default:
      return `Running ${name}`;
  }
}
