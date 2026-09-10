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
