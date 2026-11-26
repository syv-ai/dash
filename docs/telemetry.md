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

Insights to build in PostHog (project 143323, EU). All trends exclude `is_dev = true`.

| Insight                      | Type                  | Event(s)                                                     | Breakdown / formula                        | Interval |
| ---------------------------- | --------------------- | ------------------------------------------------------------ | ------------------------------------------ | -------- |
| Daily active users           | Trends, unique users  | `daily_active_user`                                          |                                            | day      |
| Weekly active users          | Trends, weekly active | `daily_active_user`                                          |                                            | week     |
| Stickiness                   | Stickiness            | `daily_active_user`                                          | days active per week                       | week     |
| Retention                    | Retention             | first `app_started` → returning `daily_active_user`          |                                            | week     |
| Tasks created                | Trends, total         | `task_created`                                               | `kind`, `source`                           | day      |
| Sessions started             | Trends, total         | `session_started`                                            | `resumed`, `model`                         | day      |
| Turns per active user        | Trends, formula       | `turn_completed` total / `daily_active_user` unique users    | A / B                                      | day      |
| Turn length                  | Trends, total         | `turn_completed`                                             | `duration_bucket`                          | week     |
| Interrupted turns            | Trends, total         | `turn_completed`                                             | `interrupted`                              | week     |
| Waits on the user            | Trends, total         | `wait_ended`                                                 | `duration_bucket`                          | week     |
| Failed turns by error        | Trends, total         | `turn_failed`                                                | `error_type`                               | day      |
| Sleep / wake / restart       | Trends, total         | `session_slept`, `session_woken`, `session_restarted`        |                                            | week     |
| Review adoption              | Trends, unique users  | `review_mode_entered`, `pr_review_submitted`                 | `verdict` (second series)                  | week     |
| Review funnel                | Funnel                | `review_mode_entered` → `pr_review_submitted` (`ok = true`)  | within 1 day                               | week     |
| Editor use                   | Trends, total         | `file_opened`                                                |                                            | week     |
| Claude Code version mix      | Trends, unique users  | `daily_active_user`                                          | `claude_version`                           | day      |
| Update restarts              | Funnel                | `claude_update_detected` → `claude_update_restart_requested` | `mode`                                     | week     |
| Dash version mix             | Trends, unique users  | `daily_active_user`                                          | `app_version`                              | day      |
| Errors                       | Trends, total         | `$exception`                                                 | `source`                                   | day      |
| Error-tracking issues        | Error tracking        | (PostHog's Error tracking view)                              | grouped by issue                           |          |
| IPC failures                 | Trends, total         | `ipc_failed`                                                 | `channel`                                  | day      |
| Claude Code contract drift   | Trends, total         | `claude_contract_drift`                                      | `source`, then `kind`, `field_path`        | week     |
| Drift by Claude Code version | Table                 | `claude_contract_drift`                                      | `claude_version` × `source` × `field_path` | all time |
