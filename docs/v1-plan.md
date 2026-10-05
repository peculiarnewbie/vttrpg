# Tabletop 1.0 — implementation plan

> **Status (2026-10-01):** P1 (dice notation, derived values), P2 (world
> compendium at scale), P3 (entry field kinds, sheet capabilities), P4
> (the corpus Worker, versioned libraries and table overrides) and P5 (the
> compendium page) are done, merged to `main` and deployed. After P4, a
> hardening pass moved all server code to Effect (typed errors, typed DO RPC)
> and put validation rules into the schemas. P5 changed course: clients cache
> the synced world index in IndexedDB instead of downloading R2 snapshots
> (the server already applies blocks, overrides and visibility).
> P6 (first-party systems) is built: four system definitions with sheets,
> importers producing validated bundles (SRD 5.2: 1,597 entries; Starforged:
> 442; Cairn 2e: 621; Blades SRD: 192), `pnpm corpus:publish` (writes R2 and
> D1 with wrangler directly — the corpus HTTP routes stay off in production,
> so P4's draft listing gap no longer blocks), searchable library text, a
> Game system setup and `/legal`. Publishing the libraries to production is a
> manual step. Known gaps: SRD 5.2 rules glossary/conditions (needs a source
> whose licence is marked per document), Blades named playbooks (not in the
> SRD). The four libraries are published to preview and production.
> P7 has started: Mythic Bastionland, Stonetop and Mothership ship as presets
> (sheets and entry types, no text) in the same Game system setup.

## Context

The user decided the 1.0 scope (docs/v1-scope.md) and architecture (docs/corpus.md):
four first-party open systems (D&D 5e SRD 5.2, Ironsworn: Starforged, Cairn 2e,
Blades in the Dark SRD), tools flexible enough for DMs to build Mythic
Bastionland, Mothership and Stonetop, and a hard line — the app helps make rolls
(content, notation, derived display values, oracle rolls) but never handles a
roll's side effects. Today's compendium is per-world, refetched whole on every
change, name-linked, capped at 2,000 entries; the dice engine only does `NdS±k`
(with bugs); layouts have no derived values; there are no shared sheets, oracle
tables, progression, or progress tracks. This plan gets from here to 1.0 in
seven shippable phases.

## Decisions (user-confirmed)

- Shared sheets (crew, steading): editable by all members; the DM can lock.
- Library versions: worlds stay pinned; DM sees "update available" + diff,
  applies in one click; per-source "follow latest" toggle.
- First-party libraries publish via a local script (`tools/publish-corpus.ts`)
  run with the user's Cloudflare credentials.
- Real Playwright specs in the repo (`e2e/*.spec.ts`, `@playwright/test`).

Defaults I'll take unless told otherwise: sharing sources with other DMs and
SRD 5.1 come after 1.0; source enablement lives only in the WorldDO (fix
corpus.md, which says D1); a separate corpus R2 bucket, also bound read-only to
the table Worker for body reads; FTS5 in DO SQLite gets a spike, with a
normalized-name `LIKE` + existing ranking fallback; for unsummed dice groups the
top-level `total` is the first group's (old clients) and chat renders every
group without comparing them.

## How every phase runs

- Branch `v1/pN-<name>`; orchestrator commits the contract first
  (schemas in `src/domain`, frames, RPC types), then 2–3 Codex workers
  (gpt-6.1-sol, reasoning high) implement non-UI slices in worktrees with
  disjoint files; orchestrator reviews, runs `pnpm check`, `pnpm test` and the
  Miniflare suites (workers can't — sandbox blocks localhost), does all UI,
  runs Playwright, merges to `main`. Push only with the user's go-ahead
  (push = production deploy).
- Merge safety: additive schema only (`Schema.optional`, `ensureColumn`, old
  JSON decodes); anything not dark-launchable sits behind `src/domain/flags.ts`
  read from wrangler `vars.FLAGS` (on in preview, off in production).
- Early refactor (start of P2): move compendium code out of the 1,884-line
  `src/server/world-do.ts` into `src/server/world-compendium.ts`, and extract the
  six copy-pasted Miniflare harnesses into `src/test/miniflare.ts` (with a
  `workers[]` option for P4). Also: `setWebSocketAutoResponse` for pings.

## P1 — Dice notation and derived values

Outcome: correct, richer dice; author-defined derived values shown on sheets and
usable in notation (`1d20+@str_mod`); clickable stats/saves/list rows with labels.

- Contract: `src/domain/dice-notation.ts` (AST: signed terms, computed counts,
  `kh`/`kl`, `adv`/`dis`, `@ref`, unsummed groups split by `|`; limits 100
  dice / 1000 sides); `src/domain/derived.ts` (`Expr`: numbers, `@key`,
  `@row.col`, `+ - * /`, parens, floor/ceil/round/min/max/abs, `if(cond,a,b)`
  with comparisons; `parseExpr`, `evaluate`, `computeDerived`); schemas:
  `RolledDie.kept?`, `RollResult.groups?`/`label?`, `roll.dice` gains
  `characterId?`; sheet-layout: `SheetLayout.derived?`, `StatItem.expr?/roll?`,
  list column kind `derived` + per-row `roll`, rolls `zeroDice?` (Blades).
- Slices: (1) parser/roller in `dice-notation.ts` + `dice.ts` (fix negative dice
  terms, reject unknown tokens, lift the 10-dice cap, keep
  `parseDiceExpression` as a shim); (2) derived engine `derived.ts` +
  `layout-rules.ts` validation (no eval, cycle detection); (3) server roll path
  in the roll handler: `@ref`s resolved server-side into labelled modifier
  parts, owner/DM only, never written back; legacy `roll` keeps working.
- UI: derived values in `sheet-blocks.tsx`, clickable stats/rows, derived editor
  in `layout-editor.tsx`, dropped dice dimmed / 2D chips past ~20 dice in
  `dice-lanes.tsx`, per-group totals in `chat.tsx`, clock-`min` bug.
- Verify: parser property tests (`1d20-1d4` subtracts), cycle tests, Miniflare
  (refs resolved server-side, non-owners rejected), Playwright: 5e ability
  block with `floor((@str-10)/2)` and a labelled save roll.

## P2 — World compendium at scale

Outcome: 10k entries per world; index sync by revision; WebSocket search;
id-based links; copies show "update available".

- Contract: `src/domain/entry-id.ts` (`<source>/<type>/<slug>`, `world` reserved
  for the world layer, `slugify`/`uniqueSlug`); `IndexRow` (no body),
  `IndexDelta {rev, upserts, deletes}`, pack v2 (v1 still imports); frames
  `search {requestId, query, typeIds?, limit≤50}` → `search.result`,
  `compendium.updated {rev}`, `error {requestId?, code?}` (world.tsx resets
  character updates only for character errors); HTTP `GET compendium/index?since`
  and `POST compendium/bodies {ids≤100}`; links `[[ref:id|Label]]` with
  `[[Name]]` fallback; copies carry `_entry` (slug id) + `_rev`.
- Slices: (1) storage/migration/search in `world-compendium.ts` + http routes:
  `rev`, revision counter, tombstones, alias table for old `ent_` ids, one-time
  migration guarded by a setting with an R2 backup first, rewrite character
  values (entry blocks, `_entry` cells), search (FTS5 spike / LIKE fallback);
  (2) domain: `entry-id.ts`, `entry-links.ts`, `compendium-rows.ts`,
  `compendium-io.ts`, new `entry-diff.ts`, `note-markdown.ts` ref syntax;
  (3) client: rewrite `src/client/compendium.ts` (delta-synced index, LRU body
  cache incl. misses, batch link resolver), new `src/client/search.ts`,
  `realtime.request()` with requestId correlation, stale-drop, timeout,
  200 ms debounce, 2-char minimum.
- UI: `EntryPicker`, `CompendiumPanel`, `entry-link-suggest.tsx` on WS search
  with type/source shown; link chips; update badge + diff + explicit apply.
- Verify: migration test (seeded `ent_` refs all resolve), no DM rows in any
  player delta/search, 10k-entry payload budget, Playwright search → link →
  rename → link still resolves.

## P3 — Entry field kinds and sheet capabilities

Before the corpus, so snapshot formats freeze on the final entry shape.

- Contract: entry field kinds `select`, `set`, `reference {typeIds, multiple}`,
  `actions` (rows `{name, roll?, text}`), `progression {rows: level → grants,
values}`, `oracle {dice, rows: min..max → text/ref}`, clickable `dice`;
  `EntryType.filters?` (range/set/flag) driving index columns and facets; inline
  dice in markdown `[[r:2d6+1|label]]`; sheet-layout: tracker display `progress`
  (10 boxes × 4 ticks), list columns `progress`/`select`, slot `size` (Cairn
  bulky), entry variant `progression` ("features up to @level", offer to copy);
  `roll.table {entryId, field}` → `RollResult.table?`; `Character.scope?:
member|world` + `SheetLayout.subject?: character|shared` (flag `sharedSheets`).
- Slices: (1) domain rules/helpers (`compendium-rules.ts`, `oracle.ts`,
  `progression.ts`, `progress.ts`, `slots.ts`); (2) server: shared sheets (all
  members edit, DM lock) and server-side oracle rolls; (3) markdown inline dice,
  rows for actions/oracles, references inside fields.
- UI: field-kind editors in `compendium-settings.tsx`; `EntryCard` action rolls,
  oracle roll highlighting the landed row, progression tables; progress track
  and slots in `sheet-blocks.tsx`; "Shared sheets" in `character-sheets.tsx`.
- Verify: unit tests per kind; Miniflare shared-sheet edit + DM lock;
  Playwright: Blades crew sheet, 0-dice pool roll, an oracle roll.

## P4 — The corpus Worker

Outcome: sources created, versioned, published to R2; worlds enable and pin
sources; world search includes source rows; overrides and blocklist.

- Contract: `workers/corpus/wrangler.jsonc` (`ttrpg-corpus`, `workers_dev:
false`, no routes; D1 `CORPUS_DB` with `workers/corpus/migrations/`, R2
  `CORPUS_BUCKET`, DO `SOURCES`→`SourceDO` sqlite via `exports`; preview env);
  table config `services: [{binding: CORPUS, entrypoint: CorpusEntrypoint}]` +
  read-only `CORPUS_BUCKET`; `src/domain/corpus-rpc.ts` (`CorpusApi`: systems,
  sources, saveEntries/deleteEntries/publish, `getLatest`, `getManifest`;
  add-only methods, `apiVersion` on calls; hand-typed `Service<CorpusEntrypoint>`
  via type-only import); `src/domain/snapshot.ts` (manifest, keys
  `corpus/<sourceId>/v<n>/…`, dictionary-coded gzipped index, DM index file);
  `licence.ts` (id, attribution, share-alike); `overrides.ts` (patch with
  `baseRev`, carries licence); WorldDO tables `world_sources(source_id, version,
mode pinned|follow)`, `entry_overrides`, `entry_blocked`.
- Slices: (1) corpus internals `workers/corpus/src/{index,entrypoint,source-do,
registry,publish}.ts` + tests; (2) table side `src/server/world-sources.ts`
  (version check on connect/alarm, batched index ingest from R2, bodies via
  Cache API → override → visibility filter, source-enabled check); (3) domain
  `snapshot.ts`, `overrides.ts`, `licence.ts` + tests.
- Orchestrator: two-worker Miniflare harness (spike: service bindings through
  `convertV4MiniflareOptions`), scripts `dev:all` (`wrangler dev -c
wrangler.jsonc -c workers/corpus/wrangler.jsonc`), `deploy:corpus`,
  `db:corpus:migrate`, `types:corpus`, tsconfig include `workers/`; UI
  "Libraries" in world settings (enable, pin/follow, update summary) and an
  override editor. Merge in two commits: corpus + flagged table code first,
  the `services` binding only after the corpus is deployed.
- User's manual steps: create D1 `ttrpg-corpus`(+preview) and R2 buckets; add
  Workers Builds connections `ttrpg-corpus` (main; `pnpm db:corpus:migrate &&
pnpm deploy:corpus`; watch `workers/corpus/**`, `src/domain/**`, lockfile) and
  `ttrpg-corpus-preview`; add watch paths to `ttrpg`; first corpus deploy by hand.
- Verify: two-worker suite — publish → enable → search finds rows; DM rows
  never reach players; pinned ignores a new version, follow adopts it; override
  applies on read; blocked entry disappears.

## P5 — Compendium browser page

- Contract: `GET /api/worlds/:id/corpus/manifests`, `GET /api/corpus/snap/<key>`
  (immutable cache, ETag; DM index for DMs only), `facets.ts`, `version-diff.ts`.
- Slices: `src/client/corpus-index.ts` (download, decode, IndexedDB by version,
  merge world layer); server snapshot proxy + bulk bodies + version diff;
  `facets.ts`/`version-diff.ts` + tests.
- UI: `src/routes/compendium-browser.tsx` — facets from type filters, sorting,
  side-by-side preview, DM curation (enable, block, override, update diffs),
  "add to my character", optional offline download of all bodies.
- Verify: cached SRD-size index loads < 1 s; Playwright filter spells by level,
  compare two, add to character (row carries `_rev`).

## P6 — First-party systems, importers, legal page

- Contract: system definitions `src/domain/systems/{dnd5e-2024,starforged,
cairn2e,blades}.ts` (layouts, entry types, filters — orchestrator-written);
  `SourceBundle` importer output; `tools/publish-corpus.ts` (reuses
  `snapshot.ts`; `wrangler r2 object put` + `d1 execute --remote`, run by the
  user); `src/routes/legal.tsx` from manifests ("based on…" wording).
- Slices (importers in `tools/importers/<lib>/` with fixture tests): (1) SRD 5.2
  from Foundry dnd5e `packs/_source` — SRD-licence documents only; `@UUID` →
  `[[ref:]]`, `[[/damage]]` → `[[r:]]`, strip `@Embed`/`[[lookup]]`; activities
  → actions, advancement → progression, monster items → refs + actions;
  recharge/uses as text only. (2) Starforged from Dataforged — oracles, moves,
  assets. (3) Cairn 2e and Blades SRD from their published texts, provenance
  recorded. (Optional, may slip: 5etools-format homebrew importer for
  user-supplied files.)
- Verify: fixture snapshots, per-library count/size report, every `[[ref:]]`
  resolves, Playwright per system (create character, roll a stat, roll an
  oracle, level-up offers features). Risks: SRD 5.2 coverage in Foundry packs;
  transcription passes for Blades/Cairn; share-alike on Cairn overrides/exports.

## P7 — Buildability proof and release

- Presets (layouts + entry types, no rules text) for Mythic Bastionland,
  Mothership and Stonetop (steading as a shared sheet) — done; `docs/buildability.md` maps each scope demand to
  the feature and the Playwright spec that proves it.
- Character builder (optional steps over the same character: sheet blocks,
  compendium choices with copy offers, chat-only rolls) — done, with a builder
  for every shipped system. Its parts since: options, placed values, scores,
  budget tallies, readouts, guidance text and a review; formulas read chosen
  entries' fields (`@class.hit_die`), level tables (`scale()`), and give
  tracker maximums (`maxFrom`), and each system's character builder uses
  them. Starforged's starship and the Blades crew have builders too; preset
  hints point to the book. Worlds set up before this keep their
  template copies without builders (setting the system up again skips sheets
  already there); a DM can add steps in the layout editor.
- Release checklist: real Google sign-in replaces the dev email stub (which
  stays live until then so the deployed site is easy to test); flags
  removed/defaulted on (`corpus-admin` stays off in production); migrations in production and
  preview; legal page and "based on" wording reviewed; search latency at 10k
  entries and index size budgets; backup/export tested; dashboard steps done;
  AGENTS.md, corpus.md, v1-scope.md updated; grep finds no "success"/"hit"
  outcome strings in chat/UI.

## Critical files

`src/server/world-do.ts` (→ `world-compendium.ts`, `world-sources.ts`),
`src/server/http.ts`, `src/domain/schemas.ts`, `src/domain/sheet-layout.ts`,
`src/domain/compendium.ts`, `src/domain/dice.ts`, `src/components/sheet-blocks.tsx`,
`src/client/compendium.ts`, `src/client/realtime.ts`, `wrangler.jsonc`,
new `workers/corpus/**`, `tools/**`, `e2e/**`.

## Verification (every phase)

`pnpm check`, `pnpm typecheck`, `pnpm test` (all Miniflare suites, run by the
orchestrator with wrangler dev stopped), phase Playwright specs against
`pnpm dev` in all three themes, then merge; production push only when the user
says so, followed by checking the Workers Builds result and a smoke test of
ttrpg.peculiarnewbie.com.
