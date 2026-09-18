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
- **Mood board** — live or DM-published backgrounds, movable images and text, with independently collapsible chat and tools

## Develop

```bash
pnpm install
pnpm dev      # migrates local D1, builds, then runs Wrangler dev
pnpm check    # lint + format + typecheck
pnpm test
```

## Deploy

```bash
pnpm deploy          # build and deploy production
pnpm deploy:preview  # deploy the already-built shared preview environment
```

Production uses the existing `ttrpg` Worker, D1 database, and R2 bucket. Preview
deploys as the isolated `ttrpg-preview` Worker with its own D1 database, R2
bucket, and Durable Object namespace.

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

Two themes ship: `posthog` (warm light paper) and `factory` (dark terminal).
Design tokens live in `src/theme/tokens.stylex.ts`; toggling happens in
`src/theme/theme-context.tsx`.

## Realtime protocol

The client opens `/api/worlds/:id/ws`, which the Worker authenticates and
forwards to the world Durable Object. Frames are validated with Effect Schema
(`src/domain/schemas.ts`). The DO broadcasts messages, roll results, character
updates, and presence, filtering private/DM frames per recipient.

## Mood board

Use **Hide chat** and **Hide tools** to reveal the board. Each panel’s visibility
is remembered per world on this browser; hiding it preserves its form state.
On narrow screens, opening one panel closes the other.

DMs choose **Edit board**, upload a **Background**, and use **Add image** or
**Add text** for movable elements. Drag an element to move it; drag its corner or
edge handles to resize it. Image corners preserve their aspect ratio (hold Shift
to resize freely); Shift preserves the ratio for text cards. Touch handles keep
large hit targets at every zoom level. Selection never opens an input panel.
Double-click or double-tap a text card, press Enter, or choose **Edit text** to type
on the card itself. Click outside or press Ctrl/Cmd+Enter to finish; Escape cancels.

Use **Bring to front**, **Delete**, **Undo**, and **Redo** for selected elements.
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
snapshot to connected members. Players view the published scene and control their
own camera. Every connection receives the latest saved snapshot, including after
reconnect. By default, edits stay private until **Publish**. Enable **Live sharing**
to automatically save and share completed edits after a 600 ms pause. Dragging
stays local until release, and camera movements always stay local. Switching Live
sharing off cancels pending automatic saves and restores manual publishing.
Undo/redo remains available after either kind of save. The sharing mode defaults
to manual when the editor is reopened in a new page session.

A stale DM tab cannot overwrite a newer publication; discard its draft to load
the latest. A failed save turns Live sharing off and preserves the draft for
recovery, rather than repeatedly retrying it.
Drafts and undo history stay in memory; leaving with unpublished changes prompts
before discarding them. This first version has no collaborative editing or cursors.

Boards are limited to 100 elements. Image uploads accept PNG, JPEG, and WebP;
the client resizes them to at most 2560 pixels on the longest side and encodes WebP.
The server limits each upload to 5 MB and serves images only to world members.
Images live in R2 at `world/<worldId>/board/<assetId>`; snapshots contain asset IDs,
not image bytes. Offscreen elements are culled. Moves and resizes preview once per animation frame
and commit to the document only when the pointer is released. Removed and abandoned
uploads are retained in R2 in this version; asset garbage collection is deferred.

`pnpm test --run` includes board schema/camera and resize/pinch tests, panel preference tests, and
integration tests using a real local Worker, D1, R2, and SQLite Durable Object.
The Node test environment keeps Miniflare on server package exports; DOM tests
opt into jsdom individually.
