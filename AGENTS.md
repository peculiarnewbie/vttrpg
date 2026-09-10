# Tabletop — Alchemy v2 + Effect + Solid.js

A small virtual tabletop that lives entirely on Cloudflare: per-world Durable
Objects, R2 file storage, D1 accounts/world registry, realtime chat, flexible
character sheets, a dice engine, and notes.

## Stack

- **Alchemy v2** — infra-as-code (Cloudflare Workers, D1, R2, Durable Objects)
- **Effect** — typed errors, dependency injection, Effect Schema, `effect/unstable/http`
- **Solid.js** — reactive UI with Solid Router (`@solidjs/router` 2)
- **StyleX** — atomic CSS-in-JS with `stylex.defineVars` / `stylex.createTheme` theming
- **Drizzle ORM** — type-safe SQL for the global D1 database
- **Vite+** — build toolchain (`vp`): dev, build, fmt, lint, test
- **Vitest** — test runner (`vp test`)
- **TypeScript 7** beta (`@typescript/native-preview`) — `tsgo --noEmit`
- **pnpm** — package manager

> **Effect is pinned to `4.0.0-rc.112`.** Alchemy beta.77 still calls
> `Config.string`; Effect `rc.113` renamed it to `Config.String`. All
> `@effect/*` packages (including `platform-node-shared`) are pinned to
> `rc.112` via `pnpm.overrides` so the tree is consistent.

## Architecture

- `alchemy.run.ts` declares D1, R2, and the Worker (with `WORLDS` Durable Object namespace)
- `src/worker.ts` — plain `ExportedHandler<Env>`; routes `/api/*` into the Effect
  `HttpRouter`, upgrades `/api/worlds/:id/ws` to the world Durable Object, and falls
  back to static assets. Also re-exports `WorldDO`.
- `src/server/` — Effect services, D1 repo, auth, HTTP routes, the `WorldDO`, dice engine
- `src/domain/` — all shared types as **Effect Schema** (client ↔ server ↔ storage)
- `src/client/` — fetch API client, WebSocket realtime client, session provider
- `src/components/` + `src/routes/` — Solid UI (StyleX)
- `src/theme/` — design tokens and the two themes (`posthog` light, `factory` dark)

### Data

- **D1** (`src/migrations/`) — accounts, sessions, worlds, world members
- **World Durable Object** (SQLite) — messages, characters, sheet templates, note metadata
- **R2** — note file contents at `world/<worldId>/notes/<noteId>.md`

## Conventions

- Model domain types with **Effect Schema**; validate all HTTP/WS input with it
- Use **Effect** idioms (`Effect.gen`, `Context.Service`, `Effect.catchTag`) in `src/server`
- Raw Cloudflare bindings are wrapped in `Effect.promise` (the template pattern)
- Style with StyleX: tokens live in `src/theme/tokens.stylex.ts`, themes in `src/theme/themes.ts`;
  spread `sx(...)` onto Solid elements
- Solid 2 notes: use `onSettled` (not `onMount`), `<Context value={...}>` (not `Context.Provider`),
  and `createEffect(compute, effect)` (two arguments)
- Keep tests next to source as `*.test.ts`; use plain `vitest` + `Effect.runPromise`

## Commands

| Run                | What it does                                 |
| ------------------ | -------------------------------------------- |
| `pnpm build`       | Build client assets into `dist/client`       |
| `pnpm dev`         | Build client, then Alchemy dev (Worker + DO) |
| `pnpm deploy`      | Build client, then deploy the stack          |
| `pnpm destroy`     | Tear down the stack                          |
| `pnpm check`       | Lint + fmt + typecheck                       |
| `pnpm test`        | Run all tests                                |
| `pnpm typecheck`   | TypeScript 7 check                           |
| `pnpm db:generate` | Generate a D1 migration                      |
