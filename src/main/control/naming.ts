/**
 * The one owner of how a capability is named on the MCP side. Pure (no
 * electron, no path aliases): the bundled `dash-mcp` shim imports it too.
 */

/** The `mcpServers` key Dash registers its shim under. */
export const DASH_MCP_SERVER = 'dash';

/** MCP tool names allow no dots: 'tasks.create' → 'tasks_create'. */
export function mcpToolName(capability: string): string {
  return capability.replace(/\./g, '_');
}

/** The tool as Claude Code's permission rules name it: 'mcp__dash__tasks_create'. */
export function mcpPermissionName(capability: string): string {
  return `mcp__${DASH_MCP_SERVER}__${mcpToolName(capability)}`;
}
