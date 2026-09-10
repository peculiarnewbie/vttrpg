import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { WorldDO } from "./src/worker";

export default Alchemy.Stack(
  "Ttrpg",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.Database("DB", {
      name: "ttrpg",
      migrations: "src/migrations",
    });

    const bucket = yield* Cloudflare.R2.Bucket("Files", {});

    const worker = yield* Cloudflare.Worker("Worker", {
      name: "ttrpg",
      main: "src/worker.ts",
      assets: "dist/client",
      compatibility: {
        date: "2026-03-22",
        flags: ["nodejs_compat"],
      },
      env: {
        DB: db,
        BUCKET: bucket,
        WORLDS: Cloudflare.DurableObject<WorldDO>("WorldDO"),
      },
    });

    return {
      url: worker.url,
    };
  }),
);
