# Tabletop

A tiny virtual tabletop on Cloudflare: realtime chat, flexible character
sheets, a dice engine, and notes. Each **world** is its own Durable Object
(SQLite) with an R2 file prefix.

Built with **Alchemy v2 + Effect + Solid.js + StyleX**.

## Features (POC)

- **Worlds** — register a world; it gets a Durable Object and `world/<id>` R2 prefix
- **Auth** — Google sign-in (dev stub for now); owners can create members as a
  Google email invite or a username/password login they manage
- **Realtime chat** — public / private / DM-only messages, plus whispers
- **Character sheets** — owner-built templates with fields, computed stats,
  tickers (HP/mana), and click-to-roll buttons
- **Dice engine** — dice sets + stacking modifiers (static, stat refs, field refs)
- **Notes** — per-world markdown files (metadata in the DO, content in R2)
- **Mood board** — DM-published backgrounds, movable images and text, with independently collapsible chat and tools

## Develop

```bash
pnpm install
pnpm dev      # builds the client, then runs Alchemy dev
pnpm check    # lint + format + typecheck
pnpm test
```

Alchemy needs a Cloudflare profile with the right scopes:

```bash
pnpm exec alchemy profile refresh --profile default --provider Cloudflare
```

## Deploy

```bash
pnpm deploy   # builds client assets, then deploys the stack
pnpm destroy  # tear everything down
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
reconnect. Editing and dragging send no board updates until Publish. A stale DM
tab cannot overwrite a newer publication; discard its draft to load the latest.
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
