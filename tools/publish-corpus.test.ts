import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SourceBundle } from "../src/domain/source-bundle";
import { decodeBodies, validateManifest } from "../src/domain/snapshot";
import {
  executePlan,
  parseOptions,
  planPublish,
  reviseEntries,
  targetFromConfig,
  type WranglerRunner,
} from "./publish-corpus";

const bundle: SourceBundle = {
  format: "ttrpg-source-bundle",
  formatVersion: 1,
  system: {
    id: "synthetic",
    name: "Synthetic system",
    description: "Invented fixtures",
    entryTypes: [
      { id: "spell", name: "Spell", fields: [{ key: "text", label: "Text", kind: "longtext" }] },
    ],
    layouts: [],
  },
  source: {
    id: "fixtures",
    systemId: "synthetic",
    name: "Author's fixtures",
    visibility: "public",
    licence: {
      id: "CC0-1.0",
      name: "CC0",
      attribution: "Original test fixtures",
      shareAlike: false,
    },
  },
  provenance: { upstream: "https://example.test/fixtures", revision: "abc", importer: "synthetic" },
  entries: [
    {
      id: "fixtures/spell/lantern",
      typeId: "spell",
      name: "Lantern",
      tags: [],
      body: "Moonlight glimmers.",
      fields: { text: "Silver mist." },
      visibility: "public",
    },
    {
      id: "fixtures/spell/hidden",
      typeId: "spell",
      name: "Hidden",
      tags: [],
      body: "Secret passage.",
      fields: {},
      visibility: "dm",
    },
  ],
};
const target = { bucket: "test-bucket", db: "test-db" };
const options = parseOptions(["fixtures", "--local"]);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "corpus-publish-test-"));
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile("workers/corpus/migrations/0001_initial.sql", "utf8"));
  cleanups.push(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const calls: string[][] = [];
  const objects = new Map<string, Uint8Array>();
  const runner: WranglerRunner = async (args) => {
    calls.push([...args]);
    if (args[0] === "d1") {
      const sql = args[args.indexOf("--command") + 1];
      let results: unknown[];
      if (sql.startsWith("SELECT")) results = db.prepare(sql).all();
      else {
        const query = "SELECT changes() AS publication_changes;";
        const index = sql.lastIndexOf(query);
        db.exec("BEGIN");
        try {
          db.exec(sql.slice(0, index));
          results = db.prepare(query).all();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      return JSON.stringify([{ success: true, results, meta: { duration: 1 } }]);
    }
    const key = args[3].slice(target.bucket.length + 1);
    const path = args[args.indexOf("--file") + 1];
    if (args[2] === "put") objects.set(key, new Uint8Array(await readFile(path)));
    else {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`Missing test object: ${key}`);
      await writeFile(path, bytes);
    }
    return "";
  };
  return { directory, db, calls, objects, runner };
};

it("parses dry-run, remote environments and shared local state targets", () => {
  expect(() => parseOptions(["fixtures"])).toThrow("Choose a target");
  expect(parseOptions(["fixtures", "--env", "production"])).toMatchObject({
    env: "production",
    local: false,
    yes: false,
  });
  expect(parseOptions(["bundle.json", "--env", "preview", "--yes"])).toEqual({
    bundlePath: "bundle.json",
    env: "preview",
    local: false,
    yes: true,
  });
  expect(() => parseOptions(["fixtures", "--env", "invalid"])).toThrow("production or preview");
  expect(() => parseOptions(["fixtures", "--local", "--env", "production"])).toThrow("not both");
  expect(
    targetFromConfig({
      r2_buckets: [{ binding: "CORPUS_BUCKET", bucket_name: "preview-files" }],
      d1_databases: [{ binding: "CORPUS_DB", database_name: "preview-db" }],
    }),
  ).toEqual({ bucket: "preview-files", db: "preview-db" });
});

it("refuses invalid bundles before calling Wrangler", async () => {
  const f = await fixture();
  await expect(
    planPublish(
      { ...bundle, entries: [{ ...bundle.entries[0], body: "![art](portrait.png)" }] },
      options,
      target,
      f.runner,
      f.directory,
    ),
  ).rejects.toThrow("Bundle refused");
  expect(f.calls).toEqual([]);
});

it("builds a dry-run plan with separate indexes/chunks, uploads manifest last and records rights/provenance", async () => {
  const f = await fixture();
  const plan = await planPublish(bundle, options, target, f.runner, f.directory);
  expect(plan?.version).toBe(1);
  expect(f.calls.every((call) => call[0] === "d1" && call.at(-1)?.startsWith("SELECT"))).toBe(true);
  expect(f.db.prepare("SELECT * FROM versions").all()).toEqual([]);
  if (!plan) throw new Error("Missing plan");
  expect(plan.manifest.bodyChunks.map((chunk) => chunk.visibility)).toEqual(["public", "dm"]);
  expect(
    plan.commands.every(
      (command) => command.includes("--local") && command.includes("--persist-to"),
    ),
  ).toBe(true);
  const uploads = plan.commands.filter((command) => command[0] === "r2");
  expect(uploads.at(-1)?.[3]).toBe("test-bucket/corpus/fixtures/v1/manifest.json");
  await executePlan(plan, f.runner);
  expect(f.db.prepare("SELECT latest_version, owner_account_id FROM sources").get()).toMatchObject({
    latest_version: 1,
    owner_account_id: "first-party",
  });
  const system = f.db.prepare("SELECT metadata FROM systems").get();
  expect(JSON.parse(String(system?.metadata))).toMatchObject({
    ...bundle.system,
    ownerAccountId: "first-party",
  });
  const registered = f.db.prepare("SELECT manifest FROM versions").get();
  expect(JSON.parse(String(registered?.manifest))).toMatchObject({
    licence: bundle.source.licence,
    provenance: bundle.provenance,
  });
  expect(
    validateManifest(
      JSON.parse(new TextDecoder().decode(f.objects.get("corpus/fixtures/v1/manifest.json"))),
    ),
  ).toEqual(plan.manifest);
  const bytes = f.objects.get(plan.manifest.bodyChunks[0].file.key);
  if (!bytes) throw new Error("Missing chunk");
  expect((await decodeBodies(bytes))[0]).toMatchObject({
    rev: 1,
    sourceRev: 1,
    sourceVersion: 1,
    licence: bundle.source.licence,
  });
});

it("reads previous R2 bodies, preserves unchanged revisions and timestamps, increments changed entries and skips no-op publication", async () => {
  const f = await fixture();
  const first = await planPublish(bundle, options, target, f.runner, f.directory);
  if (!first) throw new Error("Missing plan");
  await executePlan(first, f.runner);
  f.calls.length = 0;
  expect(await planPublish(bundle, options, target, f.runner, f.directory)).toBeUndefined();
  expect(f.calls.filter((call) => call[0] === "r2").map((call) => call[2])).toEqual([
    "get",
    "get",
    "get",
  ]);
  const changed = {
    ...bundle,
    entries: [{ ...bundle.entries[0], body: "New starlight." }, bundle.entries[1]],
  };
  const second = await planPublish(changed, options, target, f.runner, f.directory);
  if (!second) throw new Error("Missing plan");
  expect(second.version).toBe(2);
  const publicBody = (
    await decodeBodies(
      new Uint8Array(
        await readFile(join(f.directory, "next", second.manifest.bodyChunks[0].file.key)),
      ),
    )
  )[0];
  const hiddenBody = (
    await decodeBodies(
      new Uint8Array(
        await readFile(join(f.directory, "next", second.manifest.bodyChunks[1].file.key)),
      ),
    )
  )[0];
  expect(publicBody.rev).toBe(2);
  expect(hiddenBody.rev).toBe(1);
  const oldHidden = f.objects.get(first.manifest.bodyChunks[1].file.key);
  if (!oldHidden) throw new Error("Missing previous chunk");
  expect(hiddenBody.updatedAt).toBe((await decodeBodies(oldHidden))[0].updatedAt);
  await executePlan(second, f.runner);
  expect(
    f.db
      .prepare("SELECT version FROM versions ORDER BY version")
      .all()
      .map((row) => row.version),
  ).toEqual([1, 2]);
});

it("compares all content fields without object-key order or publication metadata affecting revisions", () => {
  const base = {
    ...bundle.entries[0],
    fields: { a: "one", b: "two" },
    rev: 7,
    updatedAt: "old",
    sourceVersion: 3,
    sourceRev: 7,
  };
  const previous = new Map([[base.id, base]]);
  const same = reviseEntries(
    [{ ...bundle.entries[0], fields: { b: "two", a: "one" } }],
    previous,
    "new",
  );
  expect(same.changed).toBe(false);
  expect(same.entries[0]).toMatchObject({ rev: 7, updatedAt: "old" });
  for (const patch of [
    { name: "New" },
    { tags: ["new"] },
    { body: "New" },
    { fields: { a: "changed" } },
    { visibility: "dm" as const },
  ]) {
    const result = reviseEntries([{ ...base, ...patch }], previous, "new");
    expect(result.changed).toBe(true);
    expect(result.entries[0]).toMatchObject({ rev: 8, updatedAt: "new" });
  }
  expect(reviseEntries([], previous, "new").changed).toBe(true);
  expect(
    reviseEntries(bundle.entries, new Map(), "new").entries.every((entry) => entry.rev === 1),
  ).toBe(true);
});

it("publishes metadata-only changes without bumping entry revisions", async () => {
  const f = await fixture();
  const first = await planPublish(bundle, options, target, f.runner, f.directory);
  if (!first) throw new Error("Missing plan");
  await executePlan(first, f.runner);
  const next = await planPublish(
    { ...bundle, system: { ...bundle.system, description: "New description" } },
    options,
    target,
    f.runner,
    f.directory,
  );
  expect(next?.version).toBe(2);
  expect(next?.manifest.bodyChunks).toHaveLength(2);
});

it("stops before upload on competing reservations and never advances latest after an upload failure", async () => {
  const f = await fixture();
  const first = await planPublish(bundle, options, target, f.runner, f.directory);
  if (!first) throw new Error("Missing plan");
  let puts = 0;
  const failedRunner: WranglerRunner = async (args) => {
    if (args[0] === "r2" && ++puts === 2) throw new Error("Injected upload failure");
    return f.runner(args);
  };
  await expect(executePlan(first, failedRunner)).rejects.toThrow("Injected upload failure");
  expect(f.db.prepare("SELECT latest_version FROM sources").get()?.latest_version).toBeNull();
  const before = f.calls.filter((call) => call[0] === "r2").length;
  await expect(executePlan(first, f.runner)).rejects.toThrow("UNIQUE constraint");
  expect(f.calls.filter((call) => call[0] === "r2")).toHaveLength(before);
});

it("checks old chunk integrity and refuses to overwrite somebody else's source", async () => {
  const f = await fixture();
  const first = await planPublish(bundle, options, target, f.runner, f.directory);
  if (!first) throw new Error("Missing plan");
  await executePlan(first, f.runner);
  f.objects.set(first.manifest.bodyChunks[0].file.key, new Uint8Array([1, 2, 3]));
  await expect(planPublish(bundle, options, target, f.runner, f.directory)).rejects.toThrow(
    "integrity failed",
  );
  f.db.exec("UPDATE sources SET owner_account_id='somebody-else'");
  await expect(planPublish(bundle, options, target, f.runner, f.directory)).rejects.toThrow(
    "not owned by first-party",
  );
});

it("plans remote preview and production commands with the correct environment flags", async () => {
  const f = await fixture();
  for (const env of ["preview", "production"] as const) {
    const plan = await planPublish(
      bundle,
      { ...options, local: false, env },
      target,
      f.runner,
      f.directory,
    );
    expect(
      plan?.commands.every(
        (command) =>
          command.includes("--remote") &&
          command[command.indexOf("--env") + 1] === (env === "preview" ? "preview" : ""),
      ),
    ).toBe(true);
  }
});

it("registers a large manifest with bounded command arguments and intact Unicode provenance", async () => {
  const f = await fixture();
  const large = {
    ...bundle,
    provenance: { ...bundle.provenance, notes: "Text only; attribution: author's lantern 🏮" },
    entries: Array.from({ length: 1600 }, (_, n) => ({
      ...bundle.entries[0],
      id: `fixtures/spell/fixture-${String(n).padStart(4, "0")}-${"a".repeat(40)}`,
      name: `Lantern ${n}`,
    })),
  };
  const plan = await planPublish(large, options, target, f.runner, f.directory);
  if (!plan) throw new Error("Missing plan");
  const sql = plan.commands.filter((command) => command[0] === "d1");
  expect(sql.length).toBeGreaterThan(2);
  expect(
    sql.every((command) => Buffer.byteLength(command[command.indexOf("--command") + 1]) < 100_000),
  ).toBe(true);
  await executePlan(plan, f.runner);
  const row = f.db.prepare("SELECT manifest FROM versions").get();
  const registered = JSON.parse(String(row?.manifest));
  expect(registered.provenance).toEqual(large.provenance);
  expect(validateManifest(registered)).toEqual(plan.manifest);
});

it("rejects a stale plan before uploads when latest advances", async () => {
  const f = await fixture();
  const first = await planPublish(bundle, options, target, f.runner, f.directory);
  if (!first) throw new Error("Missing plan");
  await executePlan(first, f.runner);
  const before = f.calls.filter((command) => command[0] === "r2").length;
  await expect(executePlan(first, f.runner)).rejects.toThrow("latest version changed");
  expect(f.calls.filter((command) => command[0] === "r2")).toHaveLength(before);
});
