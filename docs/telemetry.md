# Telemetry

The source of truth for what Dash sends to PostHog. Change this file in the same commit as any event.

## Rules

- **One client, in main.** `TelemetryService` (posthog-node) owns the PostHog client, the opt-out and the allowlists. The renderer only forwards events through `telemetry:capture` (`src/renderer/lib/telemetry.ts`), and main accepts only the events listed under `RENDERER_ALLOWED_EVENTS` in `telemetryIpc.ts`.
- **Shape and counts, never content.** No prompts, code, file names, paths, branch or repo names, tool input, error text from Claude Code. Durations are coarse buckets. Free text that has to go (an exception message or stack) is scrubbed first (`telemetryScrub.ts`: paths become `<path>`, tokens and email addresses `<redacted>`).
- **Allowlisted.** An event or property missing from `ALLOWED_EVENTS` / `ALLOWED_PROPERTIES` is dropped silently. Adding one means adding it there and here.
- **Opt-out wins.** Settings → "Send anonymous usage data" (`telemetry.json` in userData) and `TELEMETRY_ENABLED=false` turn everything off.
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

| Event               | When                                       | Properties            |
| ------------------- | ------------------------------------------ | --------------------- |
| `app_started`       | launch                                     |                       |
| `app_session`       | quit                                       | `session_duration_ms` |
| `app_closed`        | quit                                       |                       |
| `daily_active_user` | first launch of a day, then checked hourly | `date`, `timezone`    |

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

| Event               | When                                                        | Properties                                            |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `session_started`   | a task's Claude Code session is dispatched (`claude --bg`)  | `resumed`, `model` (alias), `permission_mode`         |
| `session_woken`     | a sleeping session is respawned                             |                                                       |
| `session_slept`     | a session is stopped (sleep)                                |                                                       |
| `session_restarted` | a session is re-dispatched (env change, update restart)     |                                                       |
| `terminal_started`  | a task pane attaches to its session                         | `source`                                              |
| `turn_completed`    | a turn ends (busy → idle/stopped), from ActivityMonitor     | `duration_bucket`, `interrupted`                      |
| `turn_failed`       | a turn ends in an error                                     | `error_type` (StopFailure's `error`, or `supervisor`) |
| `wait_ended`        | a wait on the user (permission, question, elicitation) ends | `duration_bucket`                                     |

`duration_bucket` is one of `lt_10s`, `10s_1m`, `1m_5m`, `5m_15m`, `15m_1h`, `gt_1h`.

### Review and editor

| Event                 | When                                  | Properties                                   |
| --------------------- | ------------------------------------- | -------------------------------------------- |
| `review_mode_entered` | a task enters PR review mode          | `provider`                                   |
| `review_mode_exited`  | it leaves review mode                 |                                              |
| `pr_review_submitted` | a review is submitted to the forge    | `provider`, `verdict`, `comment_count`, `ok` |
| `file_opened`         | a file opens in the editor (renderer) |                                              |

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

`$exception` sources: `uncaughtException`, `unhandledRejection` (main), `ipc` (a handler threw), `renderer:window`, `renderer:unhandledrejection`, `renderer:react-uncaught`, `renderer:react-caught` (React 19's root error callbacks). Every string of an `$exception` event, stack frames included, is scrubbed by the client's `before_send`; frames inside Dash's bundle keep their module path (`app:/dist/...`). Reports are throttled: one per distinct error per minute and 30 an hour in all (`errorThrottle.ts`). StopFailure counts are `turn_failed` by `error_type`.

## The primary dashboard

[Dash usage overview](https://eu.posthog.com/project/143323/dashboard/578348) (PostHog project 143323, EU; pinned and shared). Every insight filters `is_dev` is not `true`: the project's test-account filter is empty, and dev runs before the dev guard sent `is_dev = true` with Electron's version as `app_version`. Each insight keeps its own date range (the dashboard sets none); trends default to the last 90 days. "From v0.25" marks events that no released build sends yet; those tiles fill in once it ships.

| Section     | Tile                                             | Insight    | Event(s)                                                                                                        | Breakdown / formula                              | Interval  | Data       |
| ----------- | ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- | ---------- |
| Activity    | Active installs (DAU / WAU / MAU)                | `XMxNXQez` | `daily_active_user` unique, weekly active, monthly active                                                       |                                                  | day       | live       |
| Activity    | DAU / MAU ratio                                  | `zsqO1nYX` | `daily_active_user` unique / monthly active                                                                     | A / B, 7-day smoothing                           | day       | live       |
| Activity    | New installs per week                            | `Ku0uQ0ux` | `app_started` first time for user                                                                               |                                                  | week      | live       |
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

The issues table leaves out issue descriptions on purpose: exception messages from releases before the scrubber carry user paths, and the dashboard is shared.
