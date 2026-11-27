# Telemetry

The source of truth for what Dash sends to PostHog. Change this file in the same commit as any event.

## Rules

- **One client, in main.** `TelemetryService` (posthog-node) owns the PostHog client, the opt-out and the allowlists. The renderer only forwards events through `telemetry:capture` (`src/renderer/lib/telemetry.ts`), and main accepts only the events listed under `RENDERER_ALLOWED_EVENTS` in `telemetryIpc.ts`.
- **Shape and counts, never content.** No prompts, code, file names, paths, branch or repo names, tool input, error text from Claude Code. Durations are coarse buckets. Free text that has to go (an exception message or stack) is scrubbed first (`telemetryScrub.ts`: paths become `<path>`, tokens and email addresses `<redacted>`).
- **Allowlisted.** An event or property missing from `ALLOWED_EVENTS` / `ALLOWED_PROPERTIES` is dropped silently. Adding one means adding it there and here.
- **Opt-out wins.** Settings → Telemetry → "Send anonymous usage data" (`telemetry.json` in userData) and `TELEMETRY_ENABLED=false` turn everything off.
- **Nothing from dev or tests.** An unpackaged run sends nothing whatever its `telemetry.json` says; `TELEMETRY_ENABLED=true` opts a dev run in. Tests mock `posthog-node`.
- **Names.** `object_action`, lower snake case, past tense (`task_created`, `turn_completed`). A few older names predate the rule and stay for continuity (`app_started`, `daily_active_user`, `terminal_started`).
- **Anonymous.** `distinct_id` is a random UUID made on first run (`telemetry.json` `instanceId`); no identify, no person properties. posthog-node disables GeoIP by default.

## Properties on every event

| Property         | Meaning                                            |
| ---------------- | -------------------------------------------------- |
| `app_version`    | Dash version                                       |
| `platform`       | `darwin`, `linux`, `win32`                         |
| `arch`           | `arm64`, `x64`                                     |
| `is_dev`         | launched with `--dev` (never sent unless opted in) |
| `claude_version` | installed Claude Code, `M.m.p`, or `unknown`       |

## Events

### App

| Event               | When                                                                  | Properties                                                                     |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `app_started`       | launch                                                                |                                                                                |
| `app_session`       | quit                                                                  | `session_duration_ms`                                                          |
| `app_closed`        | quit                                                                  |                                                                                |
| `daily_active_user` | first launch of a day, then checked hourly                            | `date`, `timezone`, `active_minutes_bucket`                                    |
| `usage_snapshot`    | at most once a day, a few minutes after launch or on the hourly check | `project_count`, `open_task_count`, `live_session_count`, `peak_busy_sessions` |

`active_minutes_bucket` is the minutes a Dash window had focus on the last closed day (`0`, `lt_15m`, `15m_1h`, `1h_2h`, `2h_4h`, `4h_8h`, `gt_8h`), absent on an install's first day. Main counts them a minute at a time into `telemetry.json` (`UsageLedger`), so a day that ends in a crash still counts; `app_session` stays as it was and fires only on a clean quit.

`usage_snapshot` measures parallel work: open projects, open tasks in them, live sessions (any not asleep) now, and `peak_busy_sessions`, the most sessions working at once on the last closed day (absent on the first day). All four are count buckets: `0`, `1`, `2_3`, `4_5`, `6_10`, `11_20`, `21_50`, `gt_50`.

### Dash updates and setup

| Event                   | When                                                                     | Properties                                                                                        |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `app_update_available`  | electron-updater finds a newer Dash, once per version per run            | `from_version`, `to_version`                                                                      |
| `app_update_downloaded` | it is downloaded (installs on quit), once per version per run            | `from_version`, `to_version`                                                                      |
| `app_update_installed`  | the first launch on another version than the last launch (`lastVersion`) | `from_version`, `to_version`                                                                      |
| `app_update_failed`     | a check, download or install fails, once per stage and code per run      | `stage` (`check`, `download`, `install`), `error_code`, `from_version`, `to_version` (when known) |
| `claude_cli_missing`    | the `claude --version` probe finds no Claude Code CLI, once per run      |                                                                                                   |

`error_code` is electron-updater's or Node's code (`ERR_UPDATER_…`, `ENOTFOUND`) when identifier-shaped, else `unknown`; never the message. `app_update_installed` counts any version change, a manual install included. Claude Code authentication failures are `turn_failed` with `error_type = authentication_failed` (StopFailure is the only place Dash sees them), so there is no separate event; `platform` is on every event.

### Projects and tasks

| Event                                                                      | When                                | Properties                   |
| -------------------------------------------------------------------------- | ----------------------------------- | ---------------------------- |
| `project_added`                                                            | a project is added                  | `source` (`ui`, `api`)       |
| `project_archived` / `_restored` / `_deleted`                              | lifecycle                           |                              |
| `task_created`                                                             | a task is created                   | `kind`, `source`             |
| `task_archived` / `_restored` / `_deleted`                                 | lifecycle                           |                              |
| `worktree_created`, `worktree_created_existing_branch`, `worktree_removed` | git worktree lifecycle              |                              |
| `worktree_migrated`                                                        | the 0.16 worktree move              | `moved`, `removed`, `failed` |
| `session_adopted`                                                          | a supervisor session becomes a task |                              |

### Sessions and turns

| Event                | When                                                        | Properties                                                            |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `session_started`    | a task's Claude Code session is dispatched (`claude --bg`)  | `resumed`, `model` (alias), `permission_mode`                         |
| `session_woken`      | a sleeping session is respawned                             |                                                                       |
| `session_slept`      | a session is stopped (sleep)                                | `reason` (`manual`, `task_archived`, `project_archived`, `quit`)      |
| `session_restarted`  | a session is re-dispatched (env change, update restart)     |                                                                       |
| `terminal_started`   | a task pane attaches to its session                         |                                                                       |
| `turn_completed`     | a turn ends (busy → idle/stopped), from ActivityMonitor     | `duration_bucket`, `interrupted`, `tool_call_bucket`, `subagent_used` |
| `turn_failed`        | a turn ends in an error                                     | `error_type` (StopFailure's `error`, or `supervisor`)                 |
| `wait_ended`         | a wait on the user (permission, question, elicitation) ends | `duration_bucket`, `kind`                                             |
| `first_turn_started` | a task created this run starts its first turn               | `duration_bucket` (since the task was created)                        |

`duration_bucket` is one of `lt_10s`, `10s_1m`, `1m_5m`, `5m_15m`, `15m_1h`, `gt_1h`.

- `wait_ended.kind` is what opened the wait: `permission` (PermissionRequest, or the `permission_prompt` notification), `question` (AskUserQuestion), `elicitation` (an MCP Elicitation, or its dialog notifications), `quota` (`quota_auto_resume_stale`), or `unknown` (the supervisor listing reported the wait with no hook).
- `turn_completed.tool_call_bucket` counts every PreToolUse in the turn, the main agent's and its subagents' (count buckets as above); `subagent_used` is true when a SubagentStart came in it.
- `session_slept.reason`: `manual` (Put to sleep), `task_archived`, `project_archived` (each live session in it), `quit` (with "Stop sessions on quit" on). Claude Code's own idle stop isn't Dash's to see.
- `terminal_started` lost its `source` (always `direct`): main can't tell a first open from a re-attach or a restore.

### Review and editor

| Event                 | When                                  | Properties                                   |
| --------------------- | ------------------------------------- | -------------------------------------------- |
| `review_mode_entered` | a task enters PR review mode          | `provider`                                   |
| `review_mode_exited`  | it leaves review mode                 |                                              |
| `pr_review_submitted` | a review is submitted to the forge    | `provider`, `verdict`, `comment_count`, `ok` |
| `file_opened`         | a file opens in the editor (renderer) |                                              |

### Task outcomes

| Event           | When                                                                          | Properties                   |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `pr_opened`     | a PR new to a task's branch shows up in Dash's PR polling (renderer)          | `provider` (`github`, `ado`) |
| `branch_merged` | a PR from a task's branch that Dash saw in another state is merged (renderer) | `provider`                   |

Dash doesn't open PRs itself (the agent or the user does, with `gh` or on the forge), so both come from the polling behind the PR badge (`prOutcomes`, last states kept per task branch in localStorage). A branch listed for the first time says nothing, so PRs older than Dash's first look, or on a branch a task switched to (review mode), don't count. A PR opened and merged between two looks counts as both. A merge Dash can't see through a PR (a local merge, a push to main) isn't counted; there is no `via`, since a PR is the only way it is seen.

### Feature use

| Event                    | When                                                                                     | Properties                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `project_switched`       | the active project changes to another one (renderer)                                     |                                                                               |
| `sidebar_mode_changed`   | the task sidebar settles (1 s) in another state (renderer)                               | `mode` (`rail`, `narrow`, `expanded`)                                         |
| `terminal_drawer_opened` | the task sidebar's terminal drawer opens (renderer)                                      |                                                                               |
| `task_finder_opened`     | the task finder (⌘K) opens (renderer)                                                    |                                                                               |
| `dashctl_called`         | a control API call to a capability the caller may use, once per command and caller a day | `command` (the capability, `tasks.create`), `source` (`task`, `orchestrator`) |
| `lsp_failed`             | a language server gives up after its restarts                                            | `language_id` (`typescript`, `python`, `go`, `rust`)                          |

`dashctl_called` goes at most once a day per command and caller kind (`captureDaily`, in memory): agents call some commands in loops, so every call would be volume, not signal. Its `command` is a registered capability name; an unknown name is refused before it is counted. `sidebar_mode_changed` waits for the state to hold a second, so a pass through narrow on the way to expanded isn't counted.

Not added: onboarding steps (Dash has no onboarding flow; the new-project wizard is one step), memory panel use, services (ports) runs, remote control.

### System health

| Event                  | When                                                                                                                                                                           | Properties                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_warning_shown` | Dash's memory (its processes plus every task session's process tree) crosses the user's threshold, or macOS reports memory pressure; once per crossing (`SystemHealthService`) | `reason` (`threshold`, `pressure`), `memory_bucket` (`lt_2gb`, `2_4gb`, `4_8gb`, `8_16gb`, `16_32gb`, `gt_32gb`), `live_session_count` |
| `memory_warning_acted` | the warning's "Sleep idle tasks" is picked (renderer)                                                                                                                          | `task_count` (tasks put to sleep)                                                                                                      |

### Claude Code

| Event                             | When                                                                                            | Properties                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `claude_update_detected`          | an installed Claude Code that live sessions don't run, once per version per run                 | `outdated_count`                                                               |
| `claude_update_restart_requested` | the user picks a restart in the update dialog                                                   | `mode` (`now`, `whenDone`), `outdated_count`                                   |
| `claude_contract_drift`           | Claude Code sends something Dash doesn't expect, once per key ever (`src/main/claudeContract/`) | `claude_version` (the session's), `source`, `kind`, `field_path`, `enum_value` |

### Errors

| Event        | When                                                                                                             | Properties                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `$exception` | PostHog error tracking, via `TelemetryService.captureException` (posthog-node parses the stack)                  | `source`, `channel` (IPC), `severity` |
| `ipc_failed` | an IPC handler answered `{ success: false }`: git, forge, PTY, session and every other failure the renderer sees | `channel`, `error_code`               |

`$exception` sources: `uncaughtException`, `unhandledRejection` (main), `ipc` (a handler threw), `renderer:window`, `renderer:unhandledrejection`, `renderer:react-uncaught`, `renderer:react-caught` (React 19's root error callbacks; `react-caught` is an error an error boundary caught: `ui/ErrorBoundary` wraps the whole window, and the left sidebar, the main column and the task sidebar each, so one area failing shows a calm fallback with "Try again" and leaves the others usable, and the root's fallback offers "Reload"). Every string of an `$exception` event, stack frames included, is scrubbed by the client's `before_send`; frames inside Dash's bundle keep their module path (`app:/dist/...`). Reports are throttled: one per distinct error per minute and 30 an hour in all (`errorThrottle.ts`). StopFailure counts are `turn_failed` by `error_type`.

## The primary dashboard

[Dash usage overview](https://eu.posthog.com/project/143323/dashboard/578348) (PostHog project 143323, EU; pinned and shared). Anyone can see it, read-only, at the [public dashboard](https://eu.posthog.com/shared/P-4kS1b8eR5ntVTBWAOtgMb5aI7mxw), which Settings → Telemetry links to beside this file. Every insight filters `is_dev` is not `true`: the project's test-account filter is empty, and dev runs before the dev guard sent `is_dev = true` with Electron's version as `app_version`. Each insight keeps its own date range (the dashboard sets none); trends default to the last 90 days. "From v0.25" marks events that no released build sends yet; those tiles fill in once it ships.

| Section     | Tile                                             | Insight    | Event(s)                                                                                                        | Breakdown / formula                              | Interval  | Data       |
| ----------- | ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- | ---------- |
| Activity    | Active installs (DAU / WAU / MAU)                | `XMxNXQez` | `daily_active_user` unique, weekly active, monthly active                                                       |                                                  | day       | live       |
| Activity    | DAU / MAU ratio                                  | `zsqO1nYX` | `daily_active_user` unique / monthly active                                                                     | A / B, 7-day smoothing                           | day       | live       |
| Activity    | New installs per week                            | `Ku0uQ0ux` | `app_started` first time for user                                                                               |                                                  | week      | live       |
| Activity    | Setup failures                                   | `bo2i3ngg` | `claude_cli_missing` unique; `turn_failed` unique where `error_type = authentication_failed`                    |                                                  | week      | from v0.25 |
| Activity    | Stickiness: active days in the last 28           | `fVlJRsxD` | `daily_active_user` (stickiness)                                                                                | days active of 28                                | day       | live       |
| Activity    | Lifecycle: new, returning, resurrecting, dormant | `6HAmnnPG` | `daily_active_user` (lifecycle)                                                                                 |                                                  | week      | live       |
| Activity    | Weekly retention of new installs                 | `osZSimva` | first `app_started` → `daily_active_user` (retention)                                                           | 12 weeks                                         | week      | live       |
| Usage depth | Per active install, per week                     | `6CZdmD5O` | `task_created`, `terminal_started`, `turn_completed`, `file_opened` totals / `daily_active_user` unique         | A/E, B/E, C/E, D/E                               | week      | partly     |
| Usage depth | Time Dash stays open (median, p90)               | `AKAUG6ff` | `app_session` median and p90 of `session_duration_ms`                                                           | / 60000 (minutes)                                | week      | live       |
| Usage depth | Tasks created by source                          | `G0qdMn2I` | `task_created` total                                                                                            | `source`                                         | week      | live       |
| Usage depth | Task churn: created, archived, deleted           | `EJjB926p` | `task_created`, `task_archived`, `task_deleted` totals                                                          |                                                  | week      | live       |
| Usage depth | Sessions: started, woken, slept, restarted       | `v2SaXWRz` | `session_started`, `session_woken`, `session_slept`, `session_restarted` totals                                 |                                                  | week      | from v0.25 |
| Usage depth | Review mode                                      | `xqN4lQe7` | `review_mode_entered` unique; `pr_review_submitted` total, and total where `ok = false`                         |                                                  | week      | from v0.25 |
| Usage depth | Turn length                                      | `OmDBViun` | `turn_completed` total                                                                                          | `duration_bucket`                                | week      | from v0.25 |
| Usage depth | Interrupted turns                                | `mF151W8E` | `turn_completed` where `interrupted = true` / all `turn_completed`                                              | A / B                                            | week      | from v0.25 |
| Usage depth | Waits on the user                                | `ImaFttWB` | `wait_ended` total                                                                                              | `duration_bucket`                                | week      | from v0.25 |
| Usage depth | Parallel work                                    | `P1M5FNSC` | `usage_snapshot` total (install-days)                                                                           | `peak_busy_sessions`                             | week      | from v0.25 |
| Usage depth | Active time a day                                | `QJxQb6Q5` | `daily_active_user` total where `active_minutes_bucket` is set                                                  | `active_minutes_bucket`                          | week      | from v0.25 |
| Usage depth | Tasks that ship                                  | `0YUdjNPL` | `pr_opened`, `branch_merged` totals                                                                             |                                                  | week      | from v0.25 |
| Claude Code | Claude Code version mix                          | `ELfC0pa2` | `daily_active_user` unique                                                                                      | `claude_version`, percent stacked                | week      | from v0.25 |
| Claude Code | Claude Code update restarts                      | `QntmGOMs` | `claude_update_detected` unique; `claude_update_restart_requested` unique where `mode = now`, `mode = whenDone` |                                                  | week      | from v0.25 |
| Claude Code | Claude Code contract drift                       | `rN1m0r74` | `claude_contract_drift` total                                                                                   | `source` × `kind`                                | week      | from v0.25 |
| Claude Code | Contract drift by Claude Code version            | `U2SNfa9n` | `claude_contract_drift` unique installs (table)                                                                 | `claude_version` × `source` × `field_path`       | all time  | from v0.25 |
| Reliability | Exceptions by source                             | `EeFErvlG` | `$exception` total                                                                                              | `source`                                         | week      | live       |
| Reliability | IPC failures by channel                          | `JCUz6pOY` | `ipc_failed` total                                                                                              | `channel`                                        | week      | from v0.25 |
| Reliability | Failed turns by error type                       | `M20qb3EH` | `turn_failed` total                                                                                             | `error_type`                                     | week      | from v0.25 |
| Reliability | Error-tracking issues                            | `fchb3xWN` | SQL: `$exception` grouped by `$exception_issue_id`, joined to `system.error_tracking_issues`                    | status, type, source, count, installs, last seen | 90 days   | live       |
| Releases    | Dash version mix                                 | `0NHC8XDl` | `daily_active_user` unique                                                                                      | `app_version`, percent stacked                   | week      | live       |
| Releases    | Platform and architecture                        | `lo4veYDY` | `daily_active_user` unique                                                                                      | `platform` × `arch`                              | last 30 d | live       |
| Releases    | Dash updates                                     | `C52EbxZh` | `app_update_available`, `_downloaded`, `_installed` unique; `app_update_failed` total                           |                                                  | week      | from v0.25 |

Setup failures sits beside New installs (the row is four 3-wide tiles); Parallel work, Active time a day and Tasks that ship are a row at the end of Usage depth; Dash updates is beside Platform and architecture. Each new insight's description says "Fills in from Dash v0.25"; the section text cards still name only the earlier events (the PostHog MCP tool set has no text-card edit), so update them by hand.

The issues table leaves out issue descriptions on purpose: exception messages from releases before the scrubber carry user paths, and the dashboard is shared.
