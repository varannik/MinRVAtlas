# Legacy: the old project page

Nothing in the app reaches this folder. It holds the project page that used
to open from the Atlas's **Live dashboard** before every registry went to the
live chain. Projects are now reached through two doors only: the live chain
(`components/site/chain-view.tsx`) and the journey (`/journey`).

What is here, at the paths it used to have under `src/`:

- `components/dashboard.tsx`: how the old page was put together.
- `components/stage/`: the project stage (globe with the Removal ledger and Site pulse cards), the full ledger page and the full-screen calculation view.
- `components/dashboard/`: the filing desk (period desk, requirement workspace, GHG entries and quality review, period close and registry submission), project setup and the project top bar.
- `components/scene/`: the globe with its 3D submission board and stage mode.
- `hooks/`, `lib/`, `store/`: state and helpers only this page used.

Imports point at `@/legacy/...` for files that moved and at `@/...` for live
code, as they were when the folder was frozen. It is left out of the type
check and lint (tsconfig.json, eslint.config.mjs): live code has moved on
since, for example the demo catalogue now lives in the Atlas table, so some
imports here no longer resolve. The API routes it called
(`/api/registry/submit`, `/api/registry/setup`, …) are unchanged.

Keep it for reference, or delete the folder once nothing here is wanted.
