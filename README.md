# Tabletop

A tiny virtual tabletop on Cloudflare: realtime chat, flexible character
sheets, a dice engine, and notes. Each **world** is its own Durable Object
(SQLite) with an R2 file prefix.

Built with **Cloudflare Workers + Effect + Solid.js + StyleX**.

## Features (POC)

- **Worlds** — register a world; it gets a Durable Object and `world/<id>` R2 prefix
- **Auth** — Google sign-in (dev stub for now); owners can create members as a
  Google email invite or a username/password login they manage
- **Realtime chat** — public / private / DM-only messages, plus whispers
- **Character sheets** — owner-built templates with fields, computed stats,
  tickers (HP/mana), and click-to-roll buttons
- **Dice engine** — dice sets + stacking modifiers (static, stat refs, field refs)
- **Notes** — per-world markdown files (metadata in the DO, content in R2)
- **Mood board** — DM-prepared scenes, layered images and text, and live reveals, with independently collapsible chat and tools

## Develop

```bash
pnpm install
pnpm dev      # migrates local D1, builds, then runs Wrangler dev
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
layout as JSON. Templates can start from a premade layout (Mythic Bastionland
Classic and Compact, Mothership, Blades in the Dark) and be exported or imported as
`ttrpg-template` JSON. Older templates render through an equivalent derived layout
and can be converted; their formulas and roll modifiers stay in effect. On the
sheet, **Edit** makes fields, lists, and plain stats editable in place, saving
each value as you leave it. Layouts are prototyped at `/lab/systems`.

## Compendium

Each world has its own compendium of typed entries with fields and markdown
bodies. Only DMs edit types and entries; public entries are visible to every
member, while DM-only entries stay hidden from players. DMs export and import
`ttrpg-pack` JSON to move content between worlds; re-importing updates matching
ids. Presets contain entry types only — no copyrighted game content is shipped.

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
