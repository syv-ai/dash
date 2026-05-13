import type { LinkedToolExecution } from '../../../../shared/sessionTypes';

export function extractResultText(exec: LinkedToolExecution): string {
  const content = exec.result?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
