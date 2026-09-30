# Corpus Worker deployment

The corpus and table are separate Workers. Deploy the corpus first; only then
add the table's service binding. Until then, the table's `corpus` feature flag
stays off. Local Miniflare tests need no Cloudflare resources or credentials.

## Create the resources

In the Cloudflare dashboard, under **Storage & databases → D1**, create:

- `ttrpg-corpus` (production)
- `ttrpg-corpus-preview` (preview)

These resources were created with the authenticated `cf` CLI on 2026-09-30.
Their IDs are already in `workers/corpus/wrangler.jsonc`:

| Database               | ID                                     |
| ---------------------- | -------------------------------------- |
| `ttrpg-corpus`         | `9b2b03c6-2f2a-4865-817d-b5e0ab439b0a` |
| `ttrpg-corpus-preview` | `02c86251-9eff-446e-ac94-a8cf31e39a9d` |

Under **Storage & databases → R2**, create:

- `ttrpg-corpus-files` (production)
- `ttrpg-corpus-files-preview` (preview)

Both buckets were also created with `cf`.

Keep both buckets private. Snapshots include DM-only content. The table reads
them through an R2 binding and applies world membership, enablement, blocklist,
and visibility checks before returning content.

## First deploy

From the repository root, using your Cloudflare login:

```bash
pnpm db:corpus:migrate
pnpm deploy:corpus
pnpm db:corpus:migrate:preview
pnpm deploy:corpus:preview
```

Both Workers disable `workers.dev`, preview URLs, and public routes. The named
`CorpusEntrypoint` is available only through a service binding.

## Connect Workers Builds

Both connections were created with `cf` on 2026-09-30, including the preview
Worker's non-production branch trigger. The dashboard instructions below
describe the same configuration.

Connect `peculiarnewbie/vttrpg` to each existing corpus Worker under
**Workers & Pages → Worker → Settings → Build**. Use the repository root as
the root directory and `PNPM_VERSION=12.4.2` as a build variable.

| Setting                       | `ttrpg-corpus`                                 | `ttrpg-corpus-preview`                                         |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Production branch             | `main`                                         | `main`                                                         |
| Non-production builds         | Disabled                                       | Enabled                                                        |
| Build command                 | Leave empty                                    | Leave empty                                                    |
| Deploy command                | `pnpm db:corpus:migrate && pnpm deploy:corpus` | `pnpm db:corpus:migrate:preview && pnpm deploy:corpus:preview` |
| Non-production deploy command | Disabled                                       | `pnpm db:corpus:migrate:preview && pnpm deploy:corpus:preview` |

Set corpus build watch includes to `workers/corpus/*`, `src/domain/*`,
`package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. Cloudflare's
wildcard matches paths under these directories. Keep `src/domain/*`, `workers/corpus/*`,
`package.json`, and `pnpm-lock.yaml` included in the existing table Workers'
watch paths too (their default `*` already includes them).

Cloudflare manages the build token; credentials do not belong in the repo.
The token must permit the corpus D1 migrations and R2/DO deployment. The
default Workers Builds token does not include D1 access. Under **My Profile →
API Tokens**, edit the selected token and add **Account → D1 → Edit** for the
existing account, retaining its deployment permissions. These connections use
**Workers Builds - 2024-10-13 13:15**. Missing D1 permission causes migrations
to fail with Cloudflare error `7403`; after saving the permission, retry the
failed corpus builds from each Worker's **Deployments → Builds** view.

After **both corpus deployments succeed**, the table can bind `CORPUS` to
`ttrpg-corpus` / `ttrpg-corpus-preview`, entrypoint `CorpusEntrypoint`, and
`CORPUS_BUCKET` to the matching bucket. Its application code uses this bucket
for reads only; R2 bindings themselves do not provide a read-only setting.

Deployment order and settings follow Cloudflare's
[service binding guide](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/),
[build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
and [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).
