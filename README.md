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

For Cloudflare Workers Builds, connect this repository with `main` as the
production branch and enable builds for non-production branches. Configure:

| Setting                       | Value                    |
| ----------------------------- | ------------------------ |
| Build command                 | `pnpm build`             |
| Deploy command                | `pnpm deploy:production` |
| Non-production deploy command | `pnpm deploy:preview`    |
| Build variable                | `PNPM_VERSION=12.4.2`    |

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
**Add text** for movable elements. Drag an element to move it, select it to edit
text or dimensions, and use **Bring to front**, **Delete**, **Undo**, and **Redo**.
Arrow keys nudge selected elements (Shift moves ten units); Ctrl/Cmd+Z undoes,
Ctrl/Cmd+Shift+Z redoes. Drag empty space (or Alt/middle-drag an element) to pan,
scroll or use +/− to zoom, and use **Fit board** to find the elements again.
The mood background fills the viewport independently of the board camera.

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
not image bytes. Offscreen elements are culled, and dragging updates only the
selected element’s CSS transform once per animation frame. Removed and abandoned
uploads are retained in R2 in this version; asset garbage collection is deferred.

`pnpm test --run` includes board schema/camera tests, panel preference tests, and
integration tests using a real local Worker, D1, R2, and SQLite Durable Object.
The Node test environment keeps Miniflare on server package exports; DOM tests
opt into jsdom individually.
