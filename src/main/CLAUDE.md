# Main process

- **Task sessions** run under Claude Code's supervisor (`claude --bg`); Dash only attaches. A session runs in a pre-spawned process, so the launch command's env never reaches it: anything it needs goes in the task's settings file (`taskSettings.ts`, rewritten every start, re-read on respawn).
- **Hooks** (`ptyHookSettings.ts`): an unknown hook key makes Claude Code drop the whole file, so gate any event newer than `MIN_CLAUDE_VERSION` with `isClaudeVersionAtLeast`.
- **Control API** (`control/`): `scope.ts` is the only gate for who sees what; don't scope-check in handlers. Task lifecycle (create/archive/restore/delete, project delete) goes through `TaskService`.
