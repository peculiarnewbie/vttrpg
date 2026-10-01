/*
 * pnpm corpus:publish <source|bundle.json> --env production|preview [--yes]
 * pnpm corpus:publish <source|bundle.json> --local [--yes]
 * Defaults to a dry run: reads the registry/previous snapshot and builds local
 * files, then prints every write. --yes reserves the version, uploads its
 * objects (manifest last), and advances latest_version. Local commands use
 * .wrangler/state, shared with dev:all; apply corpus migrations first.
 * A failed upload leaves a reserved version for inspection, never overwrites it.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Effect, Layer, Schema } from "effect";
import { CorpusUnavailable } from "../src/domain/corpus-errors";
import type { CompendiumEntry } from "../src/domain/compendium";
import { SourceBundle, type BundleEntry } from "../src/domain/source-bundle";
import { Version } from "../src/domain/constraints";
import {
  decodeBodies,
  snapshotFile,
  snapshotKeys,
  snapshotLimits,
  validateManifest,
  type SnapshotManifest,
} from "../src/domain/snapshot";
import { SnapshotBucket, publishSnapshot } from "../workers/corpus/src/publish";
import { validateBundle } from "./importers/validate";

export const FIRST_PARTY_OWNER = "first-party";
export type PublishOptions = {
  bundlePath: string;
  env: "production" | "preview";
  local: boolean;
  yes: boolean;
};
export type Target = { bucket: string; db: string };
export type WranglerRunner = (args: readonly string[]) => Promise<string>;
const configPath = "workers/corpus/wrangler.jsonc";
const executeFile = promisify(execFile);
export const runWrangler: WranglerRunner = async (args) => {
  const { stdout } = await executeFile("pnpm", ["exec", "wrangler", ...args], {
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  return stdout;
};

export const parseOptions = (args: readonly string[]): PublishOptions => {
  let env: PublishOptions["env"] = "production";
  let local = false;
  let yes = false;
  let source: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes") yes = true;
    else if (arg === "--local") local = true;
    else if (arg === "--env") {
      const value = args[++i];
      if (value !== "production" && value !== "preview")
        throw new Error("--env must be production or preview");
      env = value;
    } else if (arg.startsWith("--") || source !== undefined)
      throw new Error(`Unexpected argument: ${arg}`);
    else source = arg;
  }
  if (!source)
    throw new Error(
      "Usage: corpus:publish <source|bundle.json> [--env production|preview | --local] [--yes]",
    );
  if (local && args.includes("--env")) throw new Error("Use --local or --env, not both");
  return {
    bundlePath: source.endsWith(".json") ? source : resolve(".cache/bundles", `${source}.json`),
    env,
    local,
    yes,
  };
};

export const targetFromConfig = (config: {
  r2_buckets: readonly { binding: string; bucket_name?: string }[];
  d1_databases: readonly { binding: string; database_name: string }[];
}): Target => {
  const bucket = config.r2_buckets.find((item) => item.binding === "CORPUS_BUCKET")?.bucket_name;
  const db = config.d1_databases.find((item) => item.binding === "CORPUS_DB")?.database_name;
  if (!bucket || !db) throw new Error("Corpus config must declare CORPUS_BUCKET and CORPUS_DB");
  return { bucket, db };
};
const flags = (options: PublishOptions): string[] => [
  "--config",
  configPath,
  "--env",
  options.env === "preview" ? "preview" : "",
  ...(options.local ? ["--local", "--persist-to", resolve(".wrangler/state")] : ["--remote"]),
];
const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const jsonSql = (value: unknown): string => sqlString(JSON.stringify(value));
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const content = (entry: BundleEntry | CompendiumEntry): string =>
  canonical({
    name: entry.name,
    tags: entry.tags,
    body: entry.body,
    fields: entry.fields,
    visibility: entry.visibility,
  });

export const reviseEntries = (
  entries: readonly BundleEntry[],
  previous: ReadonlyMap<string, CompendiumEntry>,
  updatedAt: string,
): { entries: CompendiumEntry[]; changed: boolean } => {
  let changed = entries.length !== previous.size;
  const revised = entries.map((entry) => {
    const old = previous.get(entry.id);
    const same = old !== undefined && content(old) === content(entry);
    if (!same) changed = true;
    return {
      ...entry,
      rev: same ? (old.rev ?? 1) : (old?.rev ?? 0) + 1,
      updatedAt: same ? old.updatedAt : updatedAt,
    };
  });
  return { entries: revised, changed };
};

type RegistryRow = {
  latest_version: number | null;
  owner_account_id: string;
  system_id: string;
  metadata: string;
  system_owner: string;
  system_metadata: string;
};
const RegistryRows = Schema.Array(
  Schema.Struct({
    latest_version: Schema.NullOr(Version),
    owner_account_id: Schema.String,
    system_id: Schema.String,
    metadata: Schema.String,
    system_owner: Schema.String,
    system_metadata: Schema.String,
  }),
);
const d1Results = (stdout: string): unknown[] => {
  const replies = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        success: Schema.Boolean,
        results: Schema.Array(Schema.Unknown),
      }),
    ),
  )(JSON.parse(stdout));
  if (replies.some((reply) => !reply.success)) throw new Error("D1 command failed");
  return replies.flatMap((reply) => reply.results);
};
export const registrationSql = (
  bundle: SourceBundle,
  manifest: SnapshotManifest,
): { reserve: string; append: readonly string[]; latest: string } => {
  const system = { ...bundle.system, ownerAccountId: FIRST_PARTY_OWNER };
  const source = { ...bundle.source, ownerAccountId: FIRST_PARTY_OWNER };
  const sourceId = sqlString(source.id);
  const owner = sqlString(FIRST_PARTY_OWNER);
  const manifestJson = JSON.stringify({ ...manifest, provenance: bundle.provenance });
  // argv has a per-argument byte limit; large SRD manifests need bounded SQL writes.
  const parts = Buffer.byteLength(manifestJson) > 48_000 ? Array.from(manifestJson) : [];
  const append: string[] = [];
  for (let start = 0; start < parts.length; start += 8_000)
    append.push(
      `UPDATE versions SET manifest=manifest || ${sqlString(parts.slice(start, start + 8_000).join(""))} WHERE source_id=${sourceId} AND version=${manifest.version}; SELECT changes() AS publication_changes;`,
    );
  return {
    reserve:
      [
        `INSERT INTO systems (id, owner_account_id, metadata) VALUES (${sqlString(system.id)}, ${owner}, ${jsonSql(system)}) ON CONFLICT(id) DO NOTHING;`,
        `INSERT INTO sources (id, system_id, owner_account_id, visibility, metadata) VALUES (${sourceId}, ${sqlString(source.systemId)}, ${owner}, ${sqlString(source.visibility)}, ${jsonSql(source)}) ON CONFLICT(id) DO NOTHING;`,
        `INSERT INTO versions (source_id, version, manifest) SELECT ${sourceId}, ${manifest.version}, ${sqlString(parts.length ? "" : manifestJson)} FROM sources s JOIN systems y ON y.id=s.system_id WHERE s.id=${sourceId} AND s.owner_account_id=${owner} AND y.owner_account_id=${owner} AND s.system_id=${sqlString(system.id)} AND COALESCE(s.latest_version, 0)=${manifest.version - 1};`,
      ].join("\n") + "\nSELECT changes() AS publication_changes;",
    append,
    latest:
      [
        `UPDATE systems SET metadata=${jsonSql(system)} WHERE id=${sqlString(system.id)} AND owner_account_id=${owner};`,
        `UPDATE sources SET metadata=${jsonSql(source)}, visibility=${sqlString(source.visibility)}, latest_version=${manifest.version} WHERE id=${sourceId} AND owner_account_id=${owner} AND COALESCE(latest_version, 0)=${manifest.version - 1};`,
      ].join("\n") + "\nSELECT changes() AS publication_changes;",
  };
};

export type PublishPlan = {
  sourceId: string;
  version: number;
  manifest: SnapshotManifest;
  commands: readonly (readonly string[])[];
};
export const planPublish = async (
  value: unknown,
  options: PublishOptions,
  target: Target,
  runner: WranglerRunner = runWrangler,
  directory = resolve(".cache/corpus-publish", randomUUID()),
): Promise<PublishPlan | undefined> => {
  const report = validateBundle(value);
  if (report.problems.length) throw new Error(`Bundle refused:\n${report.problems.join("\n")}`);
  // The validator returns diagnostics; decoding retains only the bundle fields.
  const bundle = Schema.decodeUnknownSync(SourceBundle)(value);
  const common = flags(options);
  const sql = (command: string): string[] => [
    "d1",
    "execute",
    target.db,
    ...common,
    "--json",
    "--command",
    command,
  ];
  const rows = Schema.decodeUnknownSync(RegistryRows)(
    d1Results(
      await runner(
        sql(
          `SELECT s.latest_version, s.owner_account_id, s.system_id, s.metadata, y.owner_account_id AS system_owner, y.metadata AS system_metadata FROM sources s JOIN systems y ON y.id=s.system_id WHERE s.id=${sqlString(bundle.source.id)};`,
        ),
      ),
    ),
  );
  const previousRow: RegistryRow | undefined = rows[0];
  if (
    previousRow &&
    (previousRow.owner_account_id !== FIRST_PARTY_OWNER ||
      previousRow.system_owner !== FIRST_PARTY_OWNER ||
      previousRow.system_id !== bundle.system.id)
  )
    throw new Error("Existing source/system is not owned by first-party or has a different system");
  // A new source may reuse a system; refuse to modify somebody else's system.
  if (!previousRow) {
    const owners = d1Results(
      await runner(
        sql(`SELECT owner_account_id FROM systems WHERE id=${sqlString(bundle.system.id)};`),
      ),
    );
    const decoded = Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ owner_account_id: Schema.String })),
    )(owners);
    if (decoded.some((row) => row.owner_account_id !== FIRST_PARTY_OWNER))
      throw new Error("Existing system is not owned by first-party");
  }
  const latest = previousRow?.latest_version ?? 0;
  const previous = new Map<string, CompendiumEntry>();
  let previousManifest: SnapshotManifest | undefined;
  const get = async (key: string): Promise<Uint8Array> => {
    const path = resolve(directory, "previous", key);
    await mkdir(dirname(path), { recursive: true });
    await runner(["r2", "object", "get", `${target.bucket}/${key}`, ...common, "--file", path]);
    return new Uint8Array(await readFile(path));
  };
  if (latest) {
    previousManifest = validateManifest(
      JSON.parse(
        new TextDecoder().decode(await get(snapshotKeys(bundle.source.id, latest).manifest)),
      ),
    );
    if (previousManifest.sourceId !== bundle.source.id || previousManifest.version !== latest)
      throw new Error("Previous snapshot identity does not match registry");
    for (const chunk of previousManifest.bodyChunks) {
      const bytes = await get(chunk.file.key);
      const actual = await snapshotFile(chunk.file.key, bytes);
      if (actual.bytes !== chunk.file.bytes || actual.sha256 !== chunk.file.sha256)
        throw new Error(`Previous snapshot integrity failed: ${chunk.file.key}`);
      const entries = await decodeBodies(bytes);
      if (canonical(entries.map((entry) => entry.id).sort()) !== canonical([...chunk.ids].sort()))
        throw new Error("Previous body chunk identities do not match manifest");
      for (const entry of entries) previous.set(entry.id, entry);
    }
  }
  const revised = reviseEntries(bundle.entries, previous, new Date().toISOString());
  if (
    !revised.changed &&
    previousManifest &&
    previousRow &&
    canonical(JSON.parse(previousRow.system_metadata)) ===
      canonical({ ...bundle.system, ownerAccountId: FIRST_PARTY_OWNER }) &&
    canonical(JSON.parse(previousRow.metadata)) ===
      canonical({ ...bundle.source, ownerAccountId: FIRST_PARTY_OWNER }) &&
    canonical(previousManifest.types) === canonical(bundle.system.entryTypes) &&
    canonical(previousManifest.licence) === canonical(bundle.source.licence)
  )
    return undefined;
  const version = latest + 1;
  if (version > snapshotLimits.version) throw new Error("Source version limit reached");
  const objects: { key: string; path: string; contentType: string }[] = [];
  const bucketLayer = Layer.succeed(SnapshotBucket, {
    put: (key, bytes, contentType) =>
      Effect.tryPromise({
        try: async () => {
          const path = resolve(directory, "next", key);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, bytes);
          objects.push({ key, path, contentType });
        },
        catch: (cause) =>
          new CorpusUnavailable({ message: `Cannot write snapshot: ${String(cause)}` }),
      }),
  });
  const manifest = await Effect.runPromise(
    publishSnapshot({
      source: { ...bundle.source, ownerAccountId: FIRST_PARTY_OWNER },
      types: bundle.system.entryTypes,
      entries: bundle.system.entryTypes.flatMap((type) =>
        revised.entries
          .filter((entry) => entry.typeId === type.id)
          .map((entry) => ({ entry, type })),
      ),
      version,
    }).pipe(Effect.provide(bucketLayer)),
  );
  await writeFile(
    resolve(directory, "next", snapshotKeys(bundle.source.id, version).manifest),
    JSON.stringify({ ...manifest, provenance: bundle.provenance }),
  );
  const registration = registrationSql(bundle, manifest);
  return {
    sourceId: bundle.source.id,
    version,
    manifest,
    commands: [
      sql(registration.reserve),
      ...registration.append.map(sql),
      ...objects.map(({ key, path, contentType }) => [
        "r2",
        "object",
        "put",
        `${target.bucket}/${key}`,
        ...common,
        "--file",
        path,
        "--content-type",
        contentType,
        "--force",
      ]),
      sql(registration.latest),
    ],
  };
};

export const executePlan = async (
  plan: PublishPlan,
  runner: WranglerRunner = runWrangler,
): Promise<void> => {
  for (const command of plan.commands) {
    const output = await runner(command);
    if (command[0] === "d1") {
      const results = Schema.decodeUnknownSync(
        Schema.Array(Schema.Struct({ publication_changes: Schema.Number })),
      )(d1Results(output));
      if (results.at(-1)?.publication_changes !== 1)
        throw new Error("Source ownership or latest version changed; publication stopped");
    }
  }
};
const main = async () => {
  const options = parseOptions(process.argv.slice(2));
  const { unstable_readConfig } = await import("wrangler");
  const target = targetFromConfig(
    unstable_readConfig({ config: configPath, env: options.env === "preview" ? "preview" : "" }),
  );
  const plan = await planPublish(
    JSON.parse(await readFile(options.bundlePath, "utf8")),
    options,
    target,
  );
  if (!plan) {
    console.log("Nothing changed; no version published.");
    return;
  }
  console.log(
    `${options.yes ? "Publishing" : "Dry run"}: ${plan.sourceId} v${plan.version}, ${plan.manifest.entryCount} entries → ${target.bucket} / ${target.db}`,
  );
  for (const command of plan.commands)
    console.log(`wrangler ${command.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`);
  if (options.yes) {
    await executePlan(plan);
    console.log(`Published ${plan.sourceId} v${plan.version}.`);
  } else console.log("Run again with --yes to publish.");
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main().catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
