import * as Schema from "effect/Schema";
import { build, stop, type Plugin } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, type V4WorkerOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import { ServerFrame, type ClientFrame } from "../domain/schemas";

export type CallOptions = { method?: string; body?: unknown; cookie?: string };
type ScriptWorker = Extract<V4WorkerOptions, { script: string }>;

type TabletopOptions = {
  name?: string;
  cookie?: () => string;
  // Migration fixtures only need the SQLite DO, without D1/R2 or D1 migrations.
  bindings?: boolean;
  unsafeInspectDurableObjects?: boolean;
  plugins?: Plugin[];
  workers?: (ScriptWorker & {
    entryPoint?: string;
    migrations?: { binding: string; path: string }[];
  })[];
  workerOptions?: Partial<ScriptWorker>;
  corpus?: boolean;
};

export type Tabletop = Awaited<ReturnType<typeof startTabletop>>;

export async function startTabletop(options: TabletopOptions = {}) {
  const bundle = await build({
    entryPoints: ["src/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers", "node:*"],
    target: "es2022",
    plugins: options.plugins,
  });
  const bindings = options.bindings ?? true;
  const additional = [...(options.workers ?? [])];
  if (options.corpus) {
    additional.push(
      {
        name: "corpus",
        modules: true,
        entryPoint: "workers/corpus/src/index.ts",
        script: "",
        compatibilityDate: "2026-03-22",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { SOURCES: { className: "SourceDO", useSQLite: true } },
        d1Databases: { CORPUS_DB: "corpus-registry" },
        r2Buckets: { CORPUS_BUCKET: "corpus-snapshots" },
        migrations: [{ binding: "CORPUS_DB", path: "workers/corpus/migrations/0001_initial.sql" }],
      },
      {
        name: "corpus-test-client",
        modules: true,
        compatibilityDate: "2026-03-22",
        script: `export default { async fetch(request, env) {
        const { method, call } = await request.json();
        try { return Response.json({ result: await env.CORPUS[method](call) }); }
        catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
      } };`,
        serviceBindings: { CORPUS: { name: "corpus", entrypoint: "CorpusEntrypoint" } },
      },
    );
  }
  const workers = await Promise.all(
    additional.map(async ({ entryPoint, migrations: _migrations, ...worker }) => {
      if (!entryPoint) return worker;
      const output = await build({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        external: ["cloudflare:workers", "node:*"],
        target: "es2022",
      });
      return { ...worker, script: output.outputFiles[0].text };
    }),
  );
  const name = options.name ?? "tabletop";
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name,
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-03-22",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: { WORLDS: { className: "WorldDO", useSQLite: true } },
          ...(options.unsafeInspectDurableObjects ? { unsafeInspectDurableObjects: true } : {}),
          ...(bindings ? { d1Databases: ["DB"], r2Buckets: ["BUCKET"] } : {}),
          ...(options.corpus
            ? {
                serviceBindings: { CORPUS: { name: "corpus", entrypoint: "CorpusEntrypoint" } },
                r2Buckets: { BUCKET: "BUCKET", CORPUS_BUCKET: "corpus-snapshots" },
                bindings: { FLAGS: "corpus" },
              }
            : {}),
          ...options.workerOptions,
        },
        ...workers,
      ],
    }),
  );
  const dispose = async () => {
    await mf.dispose();
    await stop();
  };
  try {
    if (bindings) {
      const db = await mf.getD1Database("DB");
      const migration = await readFile("src/migrations/0001_initial.sql", "utf8");
      for (const sql of migration
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    } else {
      await mf.ready;
    }
    for (const worker of additional) {
      for (const migration of worker.migrations ?? []) {
        const db = await mf.getD1Database(migration.binding, worker.name);
        const text = await readFile(migration.path, "utf8");
        for (const sql of text
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean))
          await db.prepare(sql).run();
      }
    }
  } catch (error) {
    await dispose();
    throw error;
  }

  const call = (path: string, init: CallOptions = {}) =>
    mf.dispatchFetch(`https://tabletop.test/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        cookie: init.cookie ?? options.cookie?.() ?? "",
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const signin = async (email: string, displayName: string) => {
    const response = await call("/auth/google", { method: "POST", body: { email, displayName } });
    const session = response.headers.get("set-cookie");
    if (!session) throw new Error("Missing session cookie");
    return session.split(";")[0];
  };
  // Suites keep their own initial-frame waits and assertions.
  const connect = async ({
    worldId,
    cookie,
    barrierNoteId = "barrier",
    missingSocketMessage = "Missing websocket",
    decodeFrame = Schema.decodeUnknownSync(ServerFrame),
  }: {
    worldId: string;
    cookie: string;
    barrierNoteId?: string;
    missingSocketMessage?: string;
    decodeFrame?: (data: unknown) => ServerFrame;
  }) => {
    const response = await mf.dispatchFetch(`https://tabletop.test/api/worlds/${worldId}/ws`, {
      headers: { cookie, Upgrade: "websocket" },
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(missingSocketMessage);
    const frames: ServerFrame[] = [];
    socket.addEventListener("message", (event) =>
      frames.push(decodeFrame(JSON.parse(String(event.data)))),
    );
    socket.accept();
    const send = (frame: ClientFrame) => socket.send(JSON.stringify(frame));
    // A reply on the same ordered socket is a barrier for preceding messages.
    const sync = async () => {
      const before = frames.filter((frame) => frame.type === "presence").length;
      send({ type: "note.saved", noteId: barrierNoteId });
      await expect
        .poll(() => frames.filter((frame) => frame.type === "presence").length)
        .toBeGreaterThan(before);
    };
    return { response, socket, frames, send, sync };
  };
  const corpusCall = async <T>(method: string, call: unknown): Promise<T> => {
    const bridge = await mf.getWorker("corpus-test-client");
    const response = await bridge.fetch("https://corpus.test/", {
      method: "POST",
      body: JSON.stringify({ method, call }),
    });
    const data = (await response.json()) as { result?: T; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Corpus RPC failed");
    return data.result as T;
  };
  return { mf, call, signin, connect, dispose, corpusCall };
}
