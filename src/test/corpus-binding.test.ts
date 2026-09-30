// @vitest-environment node
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { stop } from "esbuild";
import { expect, it } from "vitest";

/** Prove the named RPC entrypoint, SQLite DO, D1 and shared R2 in one runtime. */
it("connects two workers through a named service binding", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "table-spike",
          compatibilityDate: "2026-03-22",
          modules: true,
          script: `export default { async fetch(request, env) {
          const result = await env.CORPUS.probe();
          const body = await env.CORPUS_BUCKET.get("probe");
          return Response.json({ ...result, tableRead: await body.text() });
        } };`,
          serviceBindings: { CORPUS: { name: "corpus-spike", entrypoint: "CorpusEntrypoint" } },
          r2Buckets: { CORPUS_BUCKET: "shared-corpus" },
        },
        {
          name: "corpus-spike",
          compatibilityDate: "2026-03-22",
          modules: true,
          script: `import { WorkerEntrypoint, DurableObject } from "cloudflare:workers";
          export class SourceDO extends DurableObject {
            async read() {
              this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS probe (n INTEGER)");
              this.ctx.storage.sql.exec("INSERT INTO probe VALUES (42)");
              return this.ctx.storage.sql.exec("SELECT n FROM probe").one().n;
            }
          }
          export class CorpusEntrypoint extends WorkerEntrypoint {
            async probe() {
              await this.env.CORPUS_BUCKET.put("probe", "published");
              await this.env.CORPUS_DB.prepare("CREATE TABLE IF NOT EXISTS probe (n INTEGER)").run();
              await this.env.CORPUS_DB.prepare("INSERT INTO probe VALUES (7)").run();
              const row = await this.env.CORPUS_DB.prepare("SELECT n FROM probe").first();
              const stored = await this.env.SOURCES.getByName("test").read();
              return { registry: row.n, source: stored };
            }
          }
          export default { fetch() { return new Response("Not found", { status: 404 }); } };`,
          d1Databases: { CORPUS_DB: "corpus-registry" },
          r2Buckets: { CORPUS_BUCKET: "shared-corpus" },
          durableObjects: { SOURCES: { className: "SourceDO", useSQLite: true } },
        },
      ],
    }),
  );
  try {
    const response = await mf.dispatchFetch("https://table.test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registry: 7, source: 42, tableRead: "published" });
  } finally {
    await mf.dispose();
    await stop();
  }
}, 30_000);
