# The corpus: content at D&D scale

How game content — spells, monsters, Knights, oracles, playbooks — is stored,
versioned, searched, and brought to the table. Scope is in
[v1-scope.md](./v1-scope.md).

## Why a new design

Today each world keeps its own compendium in its Durable Object, and every
client refetches the whole thing on any change. That is fine for a Bastionland
table and breaks at D&D size: the SRD alone is about 4,600 documents, and a
group with books and homebrew reaches 3,000–10,000 entries and 10–30 MB of
text. Three problems follow: every client downloading everything, every world
storing its own copy, and name-based links colliding ("Shield" the spell and
the item).

Two mature libraries were studied for this (code and public docs only — never
their copyrighted data):

- **5etools** searches 18,221 entries with a 2.0 MB index (358 KB gzipped) of
  names and sources; everything else loads lazily. Identity is name + source,
  lore is split from mechanics, variants are declarative copies with
  modifications, and cross-references are inline tags.
- **Foundry's dnd5e system** keeps a small per-pack index and loads documents
  on demand, uses stable hand-authored ids, stamps imported copies with the id
  they came from (without syncing them), lets each type declare its browser
  filters, and models class levels as typed "advancement" entries.

Both agree on the core: a tiny index plus bodies on demand, stable identity,
copies that remember their origin, and type-declared filters. Both assume a
single machine; this design assumes many players and a server.

## Concepts

- **System** — the shape of a game: sheet layouts, entry types, progression
  tables. "D&D 5e (2024)", "Cairn 2e". Today's layout presets become systems.
- **Source** — content for a system, published in versions: "SRD 5.2",
  "My PHB notes", a group's homebrew. A source records its licence and
  attribution statement.
- **Entry** — one item of content, typed by an entry type. Its id is
  `source/type/slug`, fixed at creation; renaming changes only the display
  name, so links and references never break.
- **World layer** — what a campaign adds on top of the sources it enables:
  homebrew entries, overrides (a declarative patch over a source entry, "our
  table's Fireball"), and a blocklist.

## Two Workers

```
Browser ──► ttrpg (table Worker)                    ttrpg-corpus (content Worker)
            worlds, chat, board, characters,        systems, sources & versions,
            sessions/auth, WorldDO             ──►  entry types, publishing,
            world search index + world layer   RPC  first-party importers,
                                                    SourceDO per source, R2 snapshots
```

- The table Worker calls the corpus over a **service binding** (typed RPC via
  `WorkerEntrypoint`). Cloudflare documents these calls as adding no cost or
  latency — both usually run on the same thread.
- The browser only talks to the table Worker (one origin, one session). The
  corpus is not public: it trusts the account id the table Worker passes
  because only a service binding can reach it. Public first-party snapshots are
  edge-cached.
- Both live in this repo and share `src/domain` schemas, so the RPC contract
  is type-checked end to end. The corpus gets `workers/corpus/` and its own
  wrangler config; RPC changes stay backward compatible or deploy together.
- Campaign assets (board images, avatars) stay with the table. The corpus owns
  content assets only.

## Storage and publishing

- **SourceDO** (one per source, in the corpus Worker): SQLite with the entries,
  typed index columns for the filters each type declares, and full-text search
  if Durable Object SQLite supports it (D1 does — to verify). Editing happens
  here.
- **Publishing** freezes a version into R2 as a compact **index** (id, name,
  type, tags, filter fields; dictionary-coded like 5etools, roughly 400 KB
  gzipped at 20,000 entries) and **body chunks** per type. Published versions
  never change, so browsers and the edge cache them indefinitely. Sources with
  DM-only entries publish a separate DM index that only DMs are served.
- **D1** holds the registry: systems, sources, versions, licences, which world
  enables which source.
- Worlds **pull**: on connect a world compares its enabled source versions with
  the corpus and follows or pins by setting. The corpus never needs to know
  worlds exist.

## Search: two modes

|       | In play                                                                                            | Compendium page                                                       |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Where | Tools panel, pickers, `[[` suggestions                                                             | A dedicated route, like Plutonium's importer                          |
| How   | Debounced query over the world's existing WebSocket                                                | Full index downloaded once per source version, then local             |
| Index | Index rows of enabled sources + the world layer, held in the WorldDO's SQLite, filtered per member | Published snapshots from R2 (cached in the browser) + the world layer |

- In play, typing is **debounced** (~150–250 ms), needs a minimum query
  length, tags each query with a request id so stale replies are dropped, and
  caps results. Incoming WebSocket messages bill at 20 per request and the
  WorldDO hibernates between handlers, so search costs next to nothing.
- DM-only rows never leave the server for players.
- Entry bodies always come from R2 by id, cached, with misses cached too.
  Links are fetched in batches before rendering.
- The compendium page offers facets from each type's declared filters, sorting,
  side-by-side preview, DM curation (enable sources, block entries, start
  overrides, review update diffs), "add to my character", and an optional
  download of every body for offline use.

## References and copies

- Text stores links as ids (`[[ref:srd52/spell/fireball|Fireball]]`); the
  editor shows a chip and still lets people type `[[Fireball]]`, with the type
  and source shown to tell duplicates apart.
- Copied list rows store the id and revision they came from. When the source
  entry changes, the owner sees "update available" with a diff.
- Overrides are patches, resolved on read, and carry the source's licence
  (share-alike stays share-alike).

## D&D-shaped entry types (still data, still no automation)

- Field kinds: select and set (school, size), references (prerequisites,
  granted features), nested action lists (name, roll, text).
- **Progression tables**: level → granted features or values, so a sheet can
  list "features up to your level" as display.
- **Oracle tables**: rollable tables whose result row is shown (Starforged).
- Each type declares its filters (range, set, flag), which drive both the
  WorldDO index columns and the compendium page facets.

## First-party libraries

| Library            | Import from                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| SRD 5.2 / 5.1      | Foundry's dnd5e packs (`packs/_source`), CC BY 4.0, licence tagged per document |
| Starforged         | Dataforged (official data as JSON), CC BY 4.0                                   |
| Cairn 2e           | Published rules text, CC BY-SA 4.0                                              |
| Blades in the Dark | The SRD, CC BY 3.0                                                              |

Importers run at build time and publish ordinary sources. Monster actions
become references plus action lists rather than embedded copies. Each library
carries its attribution statement, shown on a legal page. A 5etools-format
importer reads files people supply (their own homebrew); the app never fetches
5etools data.

## Phases

1. **World compendium at scale** — slug ids, index/body split, revision-based
   sync, debounced WebSocket search, id-based links. Useful immediately.
2. **Corpus Worker** — systems and sources, SourceDO, publishing to R2, the D1
   registry, enabling sources per world, overrides, the WorldDO search index.
3. **D&D-shaped types and the compendium page** — new field kinds,
   progression and oracle tables, declared filters, the browser route.
4. **First-party libraries** — SRD 5.2 (then 5.1), Starforged, Cairn 2e,
   Blades; the 5etools-format homebrew importer.

## Open questions

- Should worlds follow a source's latest version by default, or stay pinned
  until the DM accepts an update?
- Can sources be shared with other DMs, or only reached through worlds you run?
- SRD 5.1 alongside 5.2 in 1.0, or after?
