# Wizards, the TUI transport, and feature ids

Three things here are easy to conflate because they share the id `'ports'`. They
are distinct layers:

## 1. Feature area — `featureId` (e.g. `'ports'`)

A product-area tag, **not** wizard-specific. It associates PTYs, drawer tabs,
running services (`ServiceRunner`), and persisted rows with a feature. It is the
`feature_id` column in the DB (part of a composite primary key), so the string
values are a stored contract — don't rename them lightly. A feature area can own
both a wizard _and_ long-running services under the same `featureId`.

## 2. Wizard — `src/main/wizard/`

The guided setup **flow**: orchestration (`WizardOrchestrator`), the registry
(`wizardRegistry`), the start gate (`decideWizardStart`), and per-feature wizard
implementations (`ports/`). A wizard decides _whether_ to run (relevance /
completion gates) and _what_ to render, then drives the TUI transport below.
IPC: `wizard:requestStart` / `wizard:active` / `wizard:completed`. The drawer
"+" menu is `src/shared/wizards.ts`.

## 3. TUI transport — `src/main/tui/` + `src/main/scripts/tui/`

The **rendering mechanism** a wizard uses, not a wizard itself. The wizard's UI
runs in a side-car `electron` process (`scripts/tui/index.ts`, bundled to
`tui.js` by `build:tui`) that connects back to main over a UNIX socket and
renders @clack/prompts screens. `src/main/tui/SidecarTuiHost` is the host side
that spawns it and owns the socket; the PTY `kind` is `'tui'`. Wire protocol:
`src/shared/tuiProtocol.ts` (generic envelope) + `src/shared/portsTuiProtocol.ts`
(the ports screens/choices). The per-wizard screen renderers live in
`scripts/tui/screens/` (one file per feature, e.g. `screens/ports.ts`).

## In one line

A **wizard** (layer 2) belongs to a **feature area** (layer 1) and renders its UI
through the **TUI transport** (layer 3). `DASH_TUI_FEATURE` carries the feature
id to the sidecar so it loads the matching screen handler.
