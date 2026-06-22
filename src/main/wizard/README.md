# Wizards, the toast transport, and feature ids

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
completion gates) and _what_ to render, then drives the toast transport below.
IPC: `wizard:requestStart` / `wizard:active` / `wizard:completed`. The drawer
"+" menu is `src/shared/wizards.ts`.

## 3. Toast transport — `WizardHost` + the renderer toast

The **rendering mechanism** a wizard uses, not a wizard itself. The wizard's UI
is a persistent toast in the renderer. `WizardHost` (`src/main/wizard/`) tracks
engagements and bridges each running wizard to the renderer over IPC via an
`IpcWizardChannel`: `wizard:show` pushes a screen, `wizard:message` carries the
user's choice back. The renderer side is `PortsWizardToasts.tsx`, which turns
each screen into a sonner toast. Wire protocol: `src/shared/tuiProtocol.ts`
(generic envelope) + `src/shared/portsTuiProtocol.ts` (the ports
screens/choices). The orchestrator is transport-agnostic (it only needs a
`WizardChannel`), so the same wizard could render through any surface.

## In one line

A **wizard** (layer 2) belongs to a **feature area** (layer 1) and renders its UI
through the **toast transport** (layer 3) — `WizardHost` forwards its screens to
a persistent renderer toast and routes the user's choices back.
