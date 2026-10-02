# Tabletop

A tiny virtual tabletop on Cloudflare: realtime chat, flexible character
sheets, a dice engine, and notes. Each **world** is its own Durable Object
(SQLite) with an R2 file prefix.

Built with **Cloudflare Workers + Effect + Solid.js + StyleX**.

What 1.0 is (and is deliberately not) is written down in
[docs/v1-scope.md](docs/v1-scope.md); the content architecture for D&D-scale
compendiums is in [docs/corpus.md](docs/corpus.md).

## Features (POC)

- **Worlds** — register a world; it gets a Durable Object and `world/<id>` R2 prefix
- **Auth** — Google sign-in (dev stub for now); owners can create members as a
  Google email invite or a username/password login they manage
- **Realtime chat** — public / private / DM-only messages, plus whispers
- **Character sheets** — owner-built templates with fields, computed stats,
  tickers (HP/mana), and click-to-roll buttons
- **Dice engine** — notation with keep highest/lowest, advantage, dice pools, sheet
  values (`1d20 + @str_mod`), and independent groups (`1d20+5 | 2d6+3`); it rolls,
  it never judges the result
- **Notes** — per-world markdown files (metadata in the DO, content in R2)
- **Mood board** — DM-prepared scenes, layered images and text, and live reveals, with independently collapsible chat and tools

## Develop

```bash
pnpm install
pnpm dev      # table only; migrates local D1, builds, then runs Wrangler dev
pnpm dev:all  # includes the corpus Worker and local libraries
pnpm check    # lint + format + typecheck
pnpm test
```

## Deploy

```bash
pnpm run deploy      # build and deploy production
pnpm deploy:preview  # deploy the already-built shared preview environment
```

Production uses the existing `ttrpg` Worker, D1 database, and R2 bucket. Preview
deploys as the isolated `ttrpg-preview` Worker with its own D1 database, R2
bucket, and Durable Object namespace.

Production is served at <https://ttrpg.peculiarnewbie.com>. Its custom domain is
declared in `wrangler.jsonc`; Cloudflare manages the DNS record and HTTPS
certificate when deploying. The preview environment has no custom-domain route.

For Cloudflare Workers Builds, connect this repository to both Workers. This is
Cloudflare's supported pattern for Wrangler environments and prevents a preview
build from targeting the production Worker.

Configure the `ttrpg` Worker:

| Setting                      | Value                    |
| ---------------------------- | ------------------------ |
| Production branch            | `main`                   |
| Non-production branch builds | Disabled                 |
| Build command                | `pnpm build`             |
| Deploy command               | `pnpm deploy:production` |
| Build variable               | `PNPM_VERSION=12.4.2`    |

Configure the `ttrpg-preview` Worker:

| Setting                       | Value                 |
| ----------------------------- | --------------------- |
| Production branch             | `main`                |
| Non-production branch builds  | Enabled               |
| Build command                 | `pnpm build`          |
| Deploy command                | `pnpm deploy:preview` |
| Non-production deploy command | `pnpm deploy:preview` |
| Build variable                | `PNPM_VERSION=12.4.2` |

Cloudflare manages the build token; no Cloudflare credentials belong in the
repository. Because Workers with Durable Objects do not receive version preview
URLs, non-production branches deploy to the stable shared preview Worker. The
most recently pushed non-production branch is the version available there.

D1 migrations are intentionally explicit rather than part of every code deploy:

```bash
pnpm db:migrate
pnpm db:migrate:preview
```

## Theming

Three art directions ship, chosen per player from the ⚙ menu (stored per browser):
**Rulebook** (a printed page: paper grain, EB Garamond and IM Fell small caps, one
oxblood accent), **OSR zine** (black on off-white with one riso pink, Anton and IBM
Plex Mono, hard offsets), and **Dark fantasy** (black, bronze and gold, Cinzel and
Alegreya). Older saved choices migrate: PostHog → Rulebook, Factory → Dark fantasy.

Tokens live in `src/theme/tokens.stylex.ts`: colours, font roles (`display`, `body`,
`numeric`), and a `skin` group for texture, rules, ornaments, control and tracker
shapes. Each theme is a set of `stylex.createTheme` overrides in `src/theme/themes.ts`;
`skins` there holds the few structural differences CSS can't express (the zine's
halftone name band). Fonts are self-hosted via Fontsource and only download when a
theme uses them. Prototypes of the three sheets live at `/lab/sheets`.

Tracker display is a per-tracker template option (Auto, Pips, Bar, Number); Auto
shows pips for ranges of 12 or less and a bar otherwise.

## Sheet layouts

A template's sheet is a **layout**: pages of generic blocks (headings, trackers,
stats, fields, lists with typed columns, checkboxes, text, rolls, and groups) on a
6-column grid. Blocks span columns in the side panel and can take a different span
when the sheet is wide; narrow sheets stack. Every block type has styles over the
same data (stats as a strip, bars, boxes, or a list; lists as a table, cards, or
numbered slots…). The template sets each block's default; a character's owner can
pick their own with **Style** on the sheet. Trackers keep their values in the
character's trackers, so per-character maxima and instant clicks work as before.

DMs edit layouts in **World settings → Sheet templates**: drag blocks to reorder
them, move them into or out of groups, or drop them on another page's tab (touch
drags by the ⠿ handle; with the handle focused, arrow keys reorder); ungroup a
group to keep its blocks (deleting a non-empty group asks first); duplicate and
remove blocks, edit their contents, preview at panel or wide width, or edit the
layout as JSON. Items inside blocks (stats, trackers, columns), entry-type fields,
and a sheet's list rows while editing reorder the same way, by their ⠿ handles. Templates can start from any shipped system's layout (see Game systems) and be exported or imported as
`ttrpg-template` JSON. Older templates render through an equivalent derived layout
and can be converted; their formulas and roll modifiers stay in effect. On the
sheet, **Edit** makes fields, lists, and plain stats editable in place, saving
each value as you leave it. Layouts are prototyped at `/lab/systems`.

### Character builder

A layout can carry an optional **builder**: steps that fill in the same
character the sheet edits, for making a character without facing the whole
sheet. Each step has a title, a short hint and parts:

- **Sheet blocks** — some of the sheet's own blocks, edited as on the sheet.
- **Choose from the compendium** — a searchable list with a readable preview,
  into an entry block (a Knight, a class) or a compendium-fed list (moves,
  gear). Options can come from a reference field of an entry chosen in an
  earlier step (a playbook's moves). Choosing makes the same "Add its Property
  to the sheet?" offer the sheet does; "Pick 2" is a hint, never enforced.
- **Roll buttons** and **table rolls** (oracles referenced by a chosen entry,
  or fixed ones) — plain chat rolls. Nothing a roll lands on is written to the
  character; players type in what they keep.

It's another frontend over Edit: **Builder** on any character whose layout has
one (or **Create and open builder** for a new one) opens the steps, in any
order, with Edit's Cancel and **Done** (Save). It only writes what the player
edits or accepts, so opening it on a finished character changes nothing. DMs
edit steps under **Character builder** in the layout editor, or as JSON.
Every shipped system comes with one (`builder` on its layouts in
`src/domain/systems/*-sheet.ts`); for presets the hints point to the book
rather than restate it.

### Shared sheets, tracks and slots

- A layout marked **Shared sheet** makes sheets that belong to the table — a
  Blades crew, a Stonetop steading, a ship. Every member can edit them and roll
  with them; the DM can **Lock** one so only they can change it.
- Trackers can show as a **progress** track (ten boxes of four ticks, the score
  beside it), as can list columns — a Starforged vow per row. Lists also take
  **select** columns with fixed choices.
- In the slots style, a list can take each row's size from a number column, so
  Cairn's bulky items fill two slots; the sheet counts what's used and never
  refuses an item.

### Dice and derived values

Rolls anywhere on a sheet — the rolls block, a stat or tracker label with a roll,
a list's per-row roll, a dice cell — take notation:

| Notation                      | Means                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `2d6 + 1`, `d%`, `1d20 - 1d4` | Dice and numbers; subtracted dice subtract                       |
| `4d6kh3`, `2d20kl1`           | Keep the highest / lowest                                        |
| `1d20adv`, `1d20dis`          | Advantage / disadvantage: one extra die, drop the lowest/highest |
| `1d20 + @str_mod`             | A sheet value (or a derived value) as a modifier                 |
| `(@hunt)d6khz`                | A pool sized by a value; `z`: at 0, roll two and keep the lowest |
| `1d20 + @row.bonus`           | A column of the list row being rolled                            |
| `1d20 + 5 \| 1d8 + 3`         | Separate groups, rolled together and never added                 |

The server reads the values at roll time (only the character's owner or the DM
can roll with them) and chat shows each modifier by its label. A layout's
**derived values** (`floor((@str - 10) / 2)`, `ceil(@level / 4) + 1`,
`@inventory.weight` for a list column's sum, `min`, `max`, `if`) are computed
from other values, shown wherever a stat or field uses their key, and usable in
rolls; `derived` list columns compute per row. They are never stored. The
layout editor lists problems it finds (a formula that refers to itself, a roll
using a value that isn't on the sheet) without blocking a save.

## Compendium

Each world has its own compendium of typed entries with fields and markdown
bodies. Only DMs edit types and entries; public entries are visible to every
member, while DM-only entries stay hidden from players. DMs export and import
`ttrpg-pack` JSON to move content between worlds; re-importing updates matching
ids. Presets contain entry types only — no copyrighted game content is shipped.

Entries have stable ids, `world/<type>/<slug>`, fixed when they're created, so
renaming an entry never breaks a link or a sheet (older worlds' random ids are
migrated once, after a backup to R2, and kept as aliases). A world holds up to
10,000 entries: clients keep an index of names, tags and revisions, synced by
revision after each change, and load entries' text and fields on demand; search
over the world's WebSocket finds words in entries' text as well.

- **World settings → Compendium**: define entry types (a Knight has an Ability and
  a Property list), add a premade system's types, create the types your sheet
  templates refer to, and export or import packs.
- **Compendium tab** in the tools panel: search and filter entries, read them as
  cards (dice in their lists roll), and — for DMs — write, reveal, hide, and
  delete them.
- **Compendium page** (**Compendium** next to **Table** in the world header, or
  **Full page** in the tab): every entry in a sortable list, narrowed by type
  and by the type's filters with counts (spells by level and school), a preview,
  **Pin to compare** for two entries side by side, and **Add to character**,
  which copies the entry into a sheet that takes it (the row remembers the
  entry, like "+ From compendium"). The view lives in the URL, so a link or a
  reload opens the same entry. The browser keeps the index between visits
  (per world, account and role), so reloading syncs only what changed.
- **On sheets**, an `entry` block picks one entry (a character's Knight) and shows
  it live, so compendium edits reach every sheet that links it. Picking can
  _offer_ to copy the entry's lists into the sheet (a Knight's starting
  Property); it never does so on its own. Lists with a `source` gain
  "+ From compendium", which copies an entry into a row the player can change;
  the row remembers its entry (and the revision it copied) and links back to it.
  When the entry changes, the row shows ↻: its owner sees what changed and
  chooses **Update the row** or **Keep mine** — rows never change on their own.
- **Links**: typing `[[` in chat, notes, or an entry's description suggests
  entries and inserts `[[ref:<id>|Name]]`, which survives renames; a hand-typed
  `[[Entry name]]` still links by name. Readers who can see the entry open its
  card, everyone else sees the plain name. Entry cards can be shared in chat.
- **Field kinds** beyond text, numbers, dice, tags and lists: one or several of a
  set of choices (a spell's school, a monster's senses), references to other
  entries (a class's features), **actions** with a roll each (a monster's
  attacks — click to roll), **progression** rows by level (a class table; an
  entry block's progression style shows the rows up to the character's level
  and offers to add a level's rows to a list), and **oracle** tables (roll the
  table's dice and chat shows the row it landed on). Types can declare
  **filters** (level, school, has concentration…); their values ride along in
  the index. Descriptions, notes and chat take inline rolls:
  `[[r:2d6+1|Damage]]`.
- Any block can be shown only while a value is empty or filled ("Only show when"),
  e.g. Bastionland's hand-typed Ability shows only until a Knight is linked.

## Libraries

DMs enable published libraries in **World settings → Libraries**. Each world
pins a library version; **Check for updates** lists added, changed, and removed
entries by name — click one to read what changes in its text and fields —
before **Apply update**. A per-library **Follow latest** option adopts
new versions when the world reconnects or checks for updates. Copied sheet rows
still require their owner's choice to update.

Library entries appear alongside world entries in search and on sheets. Their
text and fields load on demand from immutable R2 snapshots; DM-only entries
stay hidden from players. DMs can make a **Table override**, reset those changes,
or hide an entry in the world (**Block in this world**, or **Hide in this world**
on the compendium page) and restore it from Libraries. Overrides preserve
the library's attribution and share-alike licence. Ordinary world entry edits
never change a published library.

Packs containing table overrides can be restored in a world with the same
library versions enabled. Import checks source revisions and licences before
committing any entries; a version mismatch requires resolving the library first.

Libraries require the corpus service and the `corpus` feature flag. The app ships
no copyrighted rules text or library art. Deployment order, resource names, and
Workers Builds settings are in [docs/corpus-deployment.md](docs/corpus-deployment.md).

## Game systems

**World settings → Game system** starts a world from a system the app ships:
its character sheets (as templates) and its library, or — where the library
isn't published on this deployment — its entry types, for the DM to fill.

| System                  | Sheets                                                                                                    | Library text                                                                                                  | Licence      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ |
| Fifth Edition (SRD 5.2) | Character (derived modifiers, saves and skills from proficiency pips, spells, class features up to level) | SRD 5.2: spells, monsters, equipment, magic items, classes, subclasses, features, species, backgrounds, feats | CC BY 4.0    |
| Ironsworn: Starforged   | Character, Starship (shared)                                                                              | Moves, assets, oracles, sample NPCs, setting truths                                                           | CC BY 4.0    |
| Cairn (2nd edition)     | Character (10-slot inventory)                                                                             | Backgrounds and their tables, bestiary, spellbooks, relics, marketplace, rules                                | CC BY-SA 4.0 |
| Blades in the Dark      | Scoundrel, Crew (shared)                                                                                  | Rules, special ability pool, crew abilities, crew upgrades                                                    | CC BY 3.0    |

Sheets roll the way each game does and stop there: Starforged's action die
rolls against two separate challenge dice, Blades' pools keep the highest die
(two dice, keep the lower, at zero), oracle tables roll the die their rows span.
What a result means is the table's call. `/legal` lists every library's licence
and attribution; the libraries use the publishers' open text only — no art,
and no endorsement implied.

Games whose text isn't under an open licence ship as **presets** — sheets and
entry types only, no rules text, tables, content lists or art, marked
unofficial — and the DM writes the entries from their own book:

| System             | Sheets                                             | Entry types                                           |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| Mythic Bastionland | Classic, Compact (Virtues roll the d20 save)       | Knights, Myths (ordered omens), spark tables, people  |
| Stonetop           | Character (stats roll 2d6+stat), Steading (shared) | Playbooks, moves, arcana, steading improvements, NPCs |
| Mothership         | Classic (stats and saves roll d100; [+]/[-])       | Classes, skills, weapons, items, creatures            |

Stonetop's text is reported to be CC BY-SA 4.0; once that's confirmed from the
book's copyright page it can become a library like Cairn.

Gaps in the current text: the SRD 5.2 library has no rules glossary or
conditions yet (Foundry's rules journals mix SRD and non-SRD text without
licence markers, so they're excluded); the Blades SRD has no named playbooks or
crews (it gives their shape only), so those are types the DM writes.

### Building and publishing libraries

Importers in `tools/importers/<name>/` turn pinned upstream text into a
**bundle** (`src/domain/source-bundle.ts`), checked by one validator:

```bash
pnpm sources:fetch     # upstream text into ~/.cache/ttrpg-sources, pinned by commit
pnpm bundles:build     # .cache/bundles/<source>.json, with counts and problems
pnpm corpus:publish srd52 --local          # dry run against local dev state
pnpm corpus:publish srd52 --local --yes    # publish locally (dev server stopped)
pnpm corpus:publish srd52 --env preview    # dry run against preview; add --yes to publish
```

Publishing builds the snapshot with the corpus Worker's own code, uploads it
with wrangler (manifest last) and registers the version. Entries keep their
revision unless their content changed, so worlds pinned to the previous
version see exactly what changed; an unchanged bundle publishes nothing.
There is no default target: production needs `--env production`.

## Realtime protocol

The client opens `/api/worlds/:id/ws`, which the Worker authenticates and
forwards to the world Durable Object. Frames are validated with Effect Schema
(`src/domain/schemas.ts`). The DO broadcasts messages, roll results, character
updates, and presence, filtering private/DM frames per recipient.

## Table layout

A world opens on one thin header: the world name, who is here, the theme toggle,
and a ⚙ menu for per-browser preferences (dice totals, live cursors on mouse
devices), **World settings…** for the DM, and sign-out. Member management and
sheet templates live on the DM-only settings page (`/worlds/:id/settings`), not in
the in-session panels. Template field, stat, tracker, and roll ids are derived
from their labels until the template is first saved, then stay fixed.

Chat sits on the left and **Characters** / **Notes** on the right. Collapse either
panel to reveal the board; visibility is remembered per world on this browser and
hiding a panel preserves its form state. On phones the panels open as bottom
sheets, one at a time, from tabs in the bottom corners.

The chat composer has one **To** picker (Everyone, DM only, Only me, or a whisper
to one member) that applies to messages and rolls alike; a banner shows whenever
it isn’t Everyone. **IC/OOC** toggles in- and out-of-character.

Character sheets list trackers first, then rolls, stats, and collapsible field groups.

## Mood board

The DM’s **Scenes** menu in the board toolbar holds up to 50 scenes, with groups, renaming,
duplication, reordering, and deletion. **LIVE** marks the only scene players receive.
Open any other scene for private prep; **Show to players** makes its saved version
live. Deleting the live scene activates a neighbor; the last scene cannot be deleted.
Players fit their camera to a newly active scene. Existing boards become **Scene 1**.

DMs choose **Edit board**, upload a **Background**, and use **+ Image** or
**+ Text** for movable elements; **Done** leaves editing. Actions for the selected
element appear at the bottom of the board. Drag an element to move it; drag its corner or
edge handles to resize it. Text corners and top/bottom handles scale the lettering
and card together; left/right handles change its wrapping width at the same font
size. Image corners preserve their aspect ratio (hold Shift to resize freely).
Touch handles keep large hit targets at every zoom level. Selection never opens an input panel.
Double-click or double-tap a text card, press Enter, or choose **Edit text** to type
on the card itself. Click outside or press Ctrl/Cmd+Enter to finish; Escape cancels.

The background is an ambient backdrop per scene; add maps as image elements.
The **Layers** panel supports up to 12 layers, ordered bottom to top; new scenes
start with Map and Tokens. Select a layer for new elements. Rename, reorder, lock,
or hide layers, and use **Move to layer** for selected elements. Locked elements
cannot be selected, moved, or resized, so dragging over a locked map pans the view.
Hidden layers appear dimmed in DM edit mode and are stripped from player snapshots
on the server. Unhide a layer or move an element to a visible layer, then publish
to reveal it. Deleting a layer moves its elements to the layer below (or the next
layer when deleting the bottom layer), after confirmation.

Use **Bring to front** or **Send to back** within the selected element’s layer,
plus **Delete**, **Undo**, and **Redo**. Layer changes also participate in undo/redo.
Each completed move, resize, or text edit is one undo step. Arrow keys nudge
selected elements (Shift moves ten units); focused resize handles also respond to
arrow keys. Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes.

Drag empty space to pan, or use the **Hand** tool (H), hold Space, or Alt/middle-drag
over an element. **Select** (V) returns to moving elements. Scroll pans;
Ctrl/Cmd+scroll or a trackpad pinch zooms around the cursor. On touchscreens, two
fingers pan and pinch to zoom; adding a second finger cancels any pending object
move. The fixed +/− controls zoom, the percentage resets to 100%, and **Fit** brings
all elements into view. Keyboard +/−, 0, and 1 do the same while the canvas is
focused. The mood background fills the viewport independently of the board camera.

The interaction reference is [Excalidraw](https://github.com/excalidraw/excalidraw).
See [the implementation reference notes](docs/board-interactions.md) for source
links and a command to clone it alongside this repository.

**Publish** persists the draft in the world’s SQLite Durable Object and sends a
snapshot to connected members when editing the live scene. **Save privately** on
a prep scene updates only DM tabs. Players receive only the active scene and its
visible layers, including on reconnect, and control their own camera. By default, edits stay private until **Publish**. Enable **Live sharing**
to automatically save and share completed edits on the live scene after a 600 ms
pause. Live sharing pauses while viewing a private scene; save prep manually. Dragging
stays local until release, and camera movements always stay local. Switching Live
sharing off cancels pending automatic saves and restores manual publishing.
Undo/redo remains available after either kind of save. The sharing mode defaults
to manual when the editor is reopened in a new page session.

Each scene has its own revision. A stale DM tab cannot overwrite a newer publication; discard its draft to load
the latest. A failed save turns Live sharing off and preserves the draft for
recovery, rather than repeatedly retrying it.
Drafts and undo history stay in memory; leaving with unpublished changes prompts
before discarding them. Switching scenes also prompts before discarding a draft.
Live cursors are suppressed while the DM views private prep.

On the live scene, DMs can use **Look here** to share their current view or **Look at selection** to point
to a selected element. Players can choose **Go** on the cue or enable **Follow DM**
(remembered per world). Manual navigation keeps following enabled for the next cue.
Cues briefly outline the region and are not saved.

Boards are limited to 100 elements. Image uploads accept PNG, JPEG, and WebP;
the client resizes them to at most 4096 pixels on the longest side and encodes WebP.
The server limits each upload to 10 MB and serves images only to world members.
Images live in R2 at `world/<worldId>/board/<assetId>`; snapshots contain asset IDs,
not image bytes. Offscreen elements are culled. Moves and resizes preview once per animation frame
and commit to the document only when the pointer is released. Removed and abandoned
uploads are retained in R2 in this version; asset garbage collection is deferred.

`pnpm test --run` includes board schema/camera and resize/pinch tests, panel preference tests, and
integration tests using a real local Worker, D1, R2, and SQLite Durable Object.
The Node test environment keeps Miniflare on server package exports; DOM tests
opt into jsdom individually.
