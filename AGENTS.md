# Tabletop — Cloudflare Workers + Effect + Solid.js

A small virtual tabletop that lives entirely on Cloudflare: per-world Durable
Objects, R2 file storage, D1 accounts/world registry, realtime chat, flexible
character sheets, a dice engine, and notes.

## Product scope

Read [docs/v1-scope.md](docs/v1-scope.md) before adding features. The app helps
players make rolls (content, notation, derived display values) and never
handles a roll's side effects — no movement, targeting, automatic stat updates,
outcome evaluation ("success", "hit"), or rule enforcement; the DM and players
manage those. Content at scale follows [docs/corpus.md](docs/corpus.md).

## Stack

- **Wrangler** — Worker configuration and deployment, including D1, R2, Durable Objects, and assets
- **Effect** — typed errors, dependency injection, Effect Schema, `effect/unstable/http`
- **Solid.js** — reactive UI with Solid Router (`@solidjs/router` 2)
- **StyleX** — atomic CSS-in-JS with `stylex.defineVars` / `stylex.createTheme` theming
- **Drizzle ORM** — type-safe SQL for the global D1 database
- **Vite+** — build toolchain (`vp`): dev, build, fmt, lint, test
- **Vitest** — test runner (`vp test`)
- **TypeScript 7** beta (`@typescript/native-preview`) — `tsgo --noEmit`
- **pnpm** — package manager

> **Effect is pinned to `4.0.0-rc.112`.** All `@effect/*` packages (including
> `platform-node-shared`) are pinned to `rc.112` via `pnpm.overrides` so the
> tree is consistent.

## Architecture

- `wrangler.jsonc` declares production and preview D1, R2, assets, and the
  Worker (with the `WORLDS` Durable Object namespace)
- `src/worker.ts` — plain `ExportedHandler<Env>`; routes `/api/*` into the Effect
  `HttpRouter`, upgrades `/api/worlds/:id/ws` to the world Durable Object, and falls
  back to static assets. Also re-exports `WorldDO`.
- `src/server/` — Effect services, D1 repo, auth, HTTP routes, the `WorldDO`, dice engine
- `workers/corpus/` — the corpus Worker (published libraries: D1 registry, `SourceDO`
  drafts, immutable R2 snapshots), reached only through the table's `CORPUS` service
  binding; see [docs/corpus.md](docs/corpus.md) and [docs/v1-plan.md](docs/v1-plan.md)
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
  and `workers/` — see "Effect, fully" below
- Raw Cloudflare bindings are wrapped in `Effect.tryPromise` with a typed error
- Style with StyleX: tokens live in `src/theme/tokens.stylex.ts`, themes in `src/theme/themes.ts`;
  spread `sx(...)` onto Solid elements
- Solid 2 notes: use `onSettled` (not `onMount`), `<Context value={...}>` (not `Context.Provider`),
  and `createEffect(compute, effect)` (two arguments)
- Keep tests next to source as `*.test.ts`; use plain `vitest` + `Effect.runPromise`

## Effect, fully — not in name only

Server code (`src/server`, `workers/`, Durable Objects included) is Effect code.
Wrapping imperative code in `Effect.gen` buys nothing; the point is typed
failures and injected dependencies.

- Failures are values: `Data.TaggedError` per failure kind, returned with
  `Effect.fail`. No `throw` inside `Effect.gen`, and no `Effect.promise` around
  work that can fail — that turns errors into untyped defects.
- An error's type says what happened (`NotFound`, `Forbidden`, `Invalid`,
  `Unavailable`); map it to HTTP status or a WebSocket error frame in one place
  at the edge, never by matching message strings. Errors crossing RPC are
  encoded with a Schema and decoded back into the same tags.
- Dependencies are `Context.Service`s provided by `Layer`s (bindings, storage,
  clocks, other services), not constructor arguments threaded by hand.
- Run effects once, at the edge (the fetch/RPC/WebSocket handler). A
  `Effect.runPromise` in the middle of a method is a smell.
- Unexpected failures are logged (`Effect.logError`) before they're hidden
  behind a generic message.

## Check once, at the boundary

Validation belongs where untrusted data enters: HTTP/WS input, RPC arguments,
bytes read from storage written by another version. After that, trust the type.

- Put constraints in the Schema (lengths, patterns, finite numbers, limits) so
  decoding _is_ the validation; don't re-check the same rule by hand after.
- Define each rule once in `src/domain` (an id pattern, a size limit, an
  equality) and reuse it. A second copy of a regex or a limit will drift.
- Don't re-validate data you produced yourself or already verified. Verify
  immutable content (a published snapshot) once, then cache the verified form.
- Defensive checks cost CPU on every request and code on every change. Add one
  only for a real trust boundary or a real race, and say which in a comment.

## Derive, don't sync

Prefer state that is computed from a single source of truth over copies that
must be kept in step.

- Store a fact once. If something can be computed from stored data (a facet,
  "is this a library entry", a count), compute it — or store it as a column
  derived on write in the same transaction — instead of re-deriving it from
  string patterns in many places.
- When something changes, update what depends on _it_, not everything: a change
  to one entry touches that entry's derived rows, not the whole table.
- On the client, use `createMemo`/derived accessors over signals mirrored by
  effects.

## Commands

| Run                       | What it does                                  |
| ------------------------- | --------------------------------------------- |
| `pnpm build`              | Build client assets into `dist/client`        |
| `pnpm dev`                | Build client, then Wrangler dev (Worker + DO) |
| `pnpm deploy`             | Build client, then deploy production          |
| `pnpm deploy:preview`     | Deploy the already-built preview Worker       |
| `pnpm check`              | Lint + fmt + typecheck                        |
| `pnpm test`               | Run all tests                                 |
| `pnpm typecheck`          | TypeScript 7 check                            |
| `pnpm types`              | Regenerate Worker binding/runtime types       |
| `pnpm db:migrate:local`   | Apply local D1 migrations                     |
| `pnpm db:migrate`         | Apply production D1 migrations                |
| `pnpm db:migrate:preview` | Apply preview D1 migrations                   |
| `pnpm db:generate`        | Generate a D1 migration                       |
