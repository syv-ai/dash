import { describe, it, expect } from 'vitest';
import { DASH_MCP_SERVER, mcpPermissionName, mcpToolName } from '../naming';

describe('MCP naming', () => {
  it('turns a capability into an MCP tool name without dots', () => {
    expect(mcpToolName('tasks.create')).toBe('tasks_create');
    expect(mcpToolName('projects.list')).toBe('projects_list');
  });

  it("names the tool as Claude Code's permission rules see it", () => {
    expect(DASH_MCP_SERVER).toBe('dash');
    expect(mcpPermissionName('services.list')).toBe('mcp__dash__services_list');
  });
});
