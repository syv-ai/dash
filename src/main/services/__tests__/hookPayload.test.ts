import { describe, it, expect } from 'vitest';
import { isSubagentHook } from '../hookPayload';

describe('isSubagentHook', () => {
  it('is true when Claude Code tags the hook with an agent_id', () => {
    expect(isSubagentHook({ agent_id: 'ae82aa4f719d76ab8', agent_type: 'general-purpose' })).toBe(
      true,
    );
  });

  it('is false for the main agent, which carries no agent_id', () => {
    expect(isSubagentHook({ session_id: 's', hook_event_name: 'PreToolUse' })).toBe(false);
    expect(isSubagentHook({ agent_id: '' })).toBe(false);
  });
});
