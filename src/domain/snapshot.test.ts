import { expect, it } from "vitest";
import type { CompendiumEntry, IndexRow } from "./compendium";
import {
  decodeBodies,
  decodeIndex,
  encodeBodies,
  encodeIndex,
  snapshotFile,
  snapshotKeys,
  snapshotLimits,
  snapshotPrefix,
  validateManifest,
  type PackedIndex,
  type SnapshotManifest,
} from "./snapshot";

const row: IndexRow = {
  id: "lantern/item/moss-bell",
  typeId: "item",
  name: "Moss Bell",
  tags: ["gear", "invented"],
  rev: 7,
  updatedAt: "2026-09-30T00:00:00Z",
  visibility: "public",
  facets: { cost: 3, family: "bells", bright: true, traits: ["green", "brass"] },
};
const entry: CompendiumEntry = {
  id: row.id,
  typeId: row.typeId,
  name: row.name,
  tags: row.tags,
  rev: row.rev,
  updatedAt: row.updatedAt,
  visibility: row.visibility,
  body: "A brass bell filled with gentle green light.",
  fields: { cost: 3 },
  licence: { id: "example", name: "Example", attribution: "Lantern authors.", shareAlike: true },
  sourceVersion: 1,
  sourceRev: 7,
};
const rawGzip = async (value: unknown) =>
  new Uint8Array(
    await new Response(
      new Response(new TextEncoder().encode(JSON.stringify(value))).body!.pipeThrough(
        new CompressionStream("gzip"),
      ),
    ).arrayBuffer(),
  );
const unpack = async (bytes: Uint8Array): Promise<PackedIndex> =>
  JSON.parse(
    await new Response(
      new Response(bytes.slice()).body!.pipeThrough(new DecompressionStream("gzip")),
    ).text(),
  );
const keys = snapshotKeys("lantern", 1);
const file = (key: string) => ({ key, bytes: 200, sha256: "a".repeat(64) });
const manifest: SnapshotManifest = {
  format: "ttrpg-corpus",
  formatVersion: 1,
  sourceId: "lantern",
  sourceName: "Lantern Tales",
  systemId: "lantern-system",
  version: 1,
  publishedAt: "2026-09-30T00:00:00Z",
  licence: entry.licence!,
  types: [{ id: "item", name: "Item", fields: [] }],
  publicIndex: file(keys.publicIndex),
  dmIndex: file(keys.dmIndex),
  bodyChunks: [
    {
      typeId: "item",
      visibility: "public",
      ids: [entry.id],
      file: file(keys.body("item", "public", 0)),
    },
  ],
  entryCount: 1,
};

it("round-trips dictionary indexes, optional facets and physically separate visibility", async () => {
  const second = { ...row, id: "lantern/item/moon-bell", name: row.name, facets: undefined };
  const bytes = await encodeIndex([row, second], "public");
  expect(await decodeIndex(bytes, "public")).toEqual([row, second]);
  const packed = await unpack(bytes);
  expect(new Set(packed.strings).size).toBe(packed.strings.length);
  expect(packed.rows[0][1]).toBe(packed.rows[1][1]);
  expect(await decodeIndex(await encodeIndex([], "dm"), "dm")).toEqual([]);
  const dm = { ...row, visibility: "dm" as const };
  const dmBytes = await encodeIndex([dm], "dm");
  expect(await decodeIndex(dmBytes, "dm")).toEqual([dm]);
  await expect(decodeIndex(dmBytes, "public")).rejects.toThrow("visibility");
  await expect(encodeIndex([row, dm], "public")).rejects.toThrow("visibility");
});

it.each([10_000, 20_000])("keeps a %i-entry index within its compressed budget", async (count) => {
  const rows = Array.from({ length: count }, (_, index): IndexRow => ({
    ...row,
    id: `lantern/item/invention-${index}`,
    name: `Lantern invention ${index}`,
    rev: index + 1,
    facets: { cost: index % 10, family: "bells", bright: index % 2 === 0 },
  }));
  const bytes = await encodeIndex(rows, "public");
  expect(bytes.byteLength).toBeLessThan(count === 10_000 ? 250_000 : 400_000);
  expect(await decodeIndex(bytes, "public")).toEqual(rows);
});

it("rejects malformed schemas, dictionary references, duplicate identities and unsafe revisions", async () => {
  const packed = await unpack(await encodeIndex([row], "public"));
  for (const bad of [
    { ...packed, formatVersion: 2 },
    { ...packed, visibility: "private" },
    { ...packed, rows: [[...packed.rows[0], 99]] },
    { ...packed, rows: [[-1, ...packed.rows[0].slice(1)]] },
    { ...packed, rows: [[packed.strings.length, ...packed.rows[0].slice(1)]] },
    { ...packed, rows: [packed.rows[0], packed.rows[0]] },
    { ...packed, strings: ["../escape", ...packed.strings.slice(1)] },
    { ...packed, rows: [[...packed.rows[0].slice(0, 5), Number.MAX_SAFE_INTEGER + 1, null]] },
    { ...packed, rows: [[...packed.rows[0].slice(0, 5), 0, null]] },
    { ...packed, rows: [[...packed.rows[0].slice(0, 3), [999], ...packed.rows[0].slice(4)]] },
  ]) {
    await expect(decodeIndex(await rawGzip(bad))).rejects.toThrow();
  }
  await expect(decodeIndex(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  await expect(encodeIndex([row, row], "public")).rejects.toThrow("Duplicate");
  await expect(encodeIndex([{ ...row, facets: { cost: Infinity } }], "public")).rejects.toThrow(
    "finite",
  );
});

it("stops oversized gzip decompression before JSON parsing", async () => {
  const bytes = await rawGzip("x".repeat(snapshotLimits.indexBytes));
  expect(bytes.byteLength).toBeLessThan(100_000);
  await expect(decodeIndex(bytes)).rejects.toThrow("Decompressed snapshot exceeds size limit");
});

it("round-trips body chunks including source rights and rejects malformed bodies", async () => {
  expect(await decodeBodies(await encodeBodies([entry]))).toEqual([entry]);
  expect(await decodeBodies(await encodeBodies([]))).toEqual([]);
  await expect(encodeBodies([{ ...entry, fields: { cost: Infinity } }])).rejects.toThrow("finite");
  await expect(
    encodeBodies([entry, { ...entry, id: "lantern/item/hidden-bell", visibility: "dm" }]),
  ).rejects.toThrow("visibility");
  for (const bad of [
    { format: "other", formatVersion: 1, entries: [entry] },
    {
      format: "ttrpg-corpus-bodies",
      formatVersion: 1,
      entries: [{ ...entry, fields: { cost: null } }],
    },
    { format: "ttrpg-corpus-bodies", formatVersion: 1, entries: [entry, entry] },
    {
      format: "ttrpg-corpus-bodies",
      formatVersion: 1,
      entries: [{ ...entry, sourceRev: Number.MAX_SAFE_INTEGER + 1 }],
    },
    { format: "ttrpg-corpus-bodies", formatVersion: 1, entries: [{ ...entry, sourceVersion: 0 }] },
    {
      format: "ttrpg-corpus-bodies",
      formatVersion: 1,
      entries: [{ ...entry, body: "x".repeat(12_001) }],
    },
  ]) {
    await expect(decodeBodies(await rawGzip(bad))).rejects.toThrow();
  }
  await expect(
    encodeBodies(
      Array.from({ length: 101 }, (_, index) => ({
        ...entry,
        id: `lantern/item/invention-${index}`,
      })),
    ),
  ).rejects.toThrow("Too many");
});

it("hashes stored bytes using SHA-256", async () => {
  expect(await snapshotFile("example", new TextEncoder().encode("abc"))).toEqual({
    key: "example",
    bytes: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
});

it("validates exact source keys and chunk identity/counts without mutating manifests", () => {
  expect(validateManifest(manifest)).toEqual(manifest);
  expect(validateManifest({ ...manifest, bodyChunks: [], entryCount: 0 })).toEqual({
    ...manifest,
    bodyChunks: [],
    entryCount: 0,
  });
  const chunk = manifest.bodyChunks[0];
  for (const bad of [
    { ...manifest, sourceId: "../lantern" },
    { ...manifest, sourceId: "world" },
    { ...manifest, systemId: "../system" },
    { ...manifest, version: 0 },
    { ...manifest, version: snapshotLimits.version + 1 },
    { ...manifest, publicIndex: file("corpus/lantern/v1/../index.public.json.gz") },
    { ...manifest, publicIndex: file(snapshotKeys("other", 1).publicIndex) },
    { ...manifest, dmIndex: file(keys.publicIndex) },
    { ...manifest, dmIndex: file(snapshotKeys("lantern", 2).dmIndex) },
    { ...manifest, publicIndex: { ...manifest.publicIndex, bytes: -1 } },
    { ...manifest, publicIndex: { ...manifest.publicIndex, bytes: snapshotLimits.indexBytes + 1 } },
    { ...manifest, publicIndex: { ...manifest.publicIndex, sha256: "invalid" } },
    { ...manifest, entryCount: 2 },
    { ...manifest, entryCount: -1 },
    { ...manifest, types: [manifest.types[0], manifest.types[0]] },
    { ...manifest, bodyChunks: [chunk, chunk], entryCount: 2 },
    { ...manifest, bodyChunks: [{ ...chunk, ids: ["other/item/moss-bell"] }] },
    { ...manifest, bodyChunks: [{ ...chunk, ids: ["lantern/spell/moss-bell"] }] },
    { ...manifest, bodyChunks: [{ ...chunk, visibility: "dm" }] },
    {
      ...manifest,
      bodyChunks: [{ ...chunk, file: file(keys.body("item", "public", 1).replace(".1.", ".01.")) }],
    },
    { ...manifest, bodyChunks: [{ ...chunk, ids: [] }], entryCount: 0 },
  ]) {
    expect(() => validateManifest(bad)).toThrow();
  }
});

it("bounds snapshot key parts and versions", () => {
  expect(snapshotPrefix("lantern", 1)).toBe("corpus/lantern/v1");
  for (const source of ["world", "../source", "", "x".repeat(61)])
    expect(() => snapshotPrefix(source, 1)).toThrow();
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => snapshotPrefix("lantern", version)).toThrow();
  expect(() => keys.body("../item", "public", 0)).toThrow();
  expect(() => keys.body("item", "public", -1)).toThrow();
});

it("accepts the maximum snapshot version and rejects versions above it", () => {
  const maximumKeys = snapshotKeys("lantern", snapshotLimits.version);
  const maximumManifest = {
    ...manifest,
    version: snapshotLimits.version,
    publicIndex: file(maximumKeys.publicIndex),
    dmIndex: file(maximumKeys.dmIndex),
    bodyChunks: [
      {
        ...manifest.bodyChunks[0],
        file: file(maximumKeys.body("item", "public", 0)),
      },
    ],
  };
  expect(validateManifest(maximumManifest)).toEqual(maximumManifest);
  expect(() =>
    validateManifest({ ...maximumManifest, version: snapshotLimits.version + 1 }),
  ).toThrow("Invalid source version");
  expect(() => snapshotPrefix("lantern", snapshotLimits.version + 1)).toThrow(
    "Invalid source version",
  );
});
