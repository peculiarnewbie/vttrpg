import { Effect } from "effect";
import { expect, it } from "vitest";
import type { CompendiumEntry, EntryType } from "../../../src/domain/compendium";
import type { CorpusSource } from "../../../src/domain/corpus-rpc";
import { decodeBodies, decodeIndex, snapshotKeys } from "../../../src/domain/snapshot";
import { publishSnapshot } from "./publish";

const source: CorpusSource = {
  id: "synthetic",
  systemId: "invented",
  name: "Synthetic fixtures",
  ownerAccountId: "owner",
  visibility: "public",
  licence: {
    id: "CC0-1.0",
    name: "CC0 1.0",
    attribution: "Original synthetic fixtures written for testing.",
    shareAlike: false,
  },
};
const type: EntryType = {
  id: "spell",
  name: "Spell",
  fields: [{ key: "level", label: "Level", kind: "number" }],
  filters: [{ key: "level", kind: "range" }],
};
const entry = (n: number, visibility: "public" | "dm"): CompendiumEntry => ({
  id: `synthetic/spell/fixture-${n}`,
  typeId: "spell",
  name: `Invented lantern ${n}`,
  tags: ["synthetic"],
  body: `Original fixture ${n}.`,
  fields: { level: n % 5 },
  visibility,
  rev: n + 1,
  updatedAt: "2026-09-30T00:00:00.000Z",
});

const bucketFixture = (failKey?: string) => {
  const objects = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const bucket = {
    put: async (key: string, value: string | Uint8Array) => {
      writes.push(key);
      if (key === failKey) throw new Error("Injected R2 failure");
      objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : value.slice());
      return {};
    },
  } as unknown as R2Bucket;
  return { bucket, objects, writes };
};

it("publishes separate bounded chunks and indexes, rights, facets and source revisions", async () => {
  const fixture = bucketFixture();
  const entries = Array.from({ length: 103 }, (_, n) => entry(n, "public"));
  entries.push(entry(103, "dm"));
  const manifest = await Effect.runPromise(
    publishSnapshot(fixture.bucket, { source, types: [type], entries, version: 1 }),
  );
  const keys = snapshotKeys(source.id, 1);
  expect(fixture.writes.at(-1)).toBe(keys.manifest);
  expect(manifest.bodyChunks.map((chunk) => chunk.ids.length)).toEqual([100, 3, 1]);
  const publicRows = await decodeIndex(fixture.objects.get(keys.publicIndex)!, "public");
  const dmRows = await decodeIndex(fixture.objects.get(keys.dmIndex)!, "dm");
  expect(publicRows).toHaveLength(103);
  expect(publicRows.every((row) => row.visibility === "public")).toBe(true);
  expect(publicRows[0].facets).toEqual({ level: 0 });
  expect(dmRows.map((row) => row.id)).toEqual([entries[103].id]);
  const bodies = await decodeBodies(fixture.objects.get(manifest.bodyChunks[0].file.key)!);
  expect(bodies.every((body) => body.visibility === "public")).toBe(true);
  expect(bodies[0]).toMatchObject({
    licence: source.licence,
    sourceVersion: 1,
    sourceRev: 1,
    rev: 1,
  });
  expect(manifest.types).toEqual([type]);
});

it("does not write a manifest after a partial object failure", async () => {
  const keys = snapshotKeys(source.id, 4);
  const fixture = bucketFixture(keys.body("spell", "dm", 0));
  await expect(
    Effect.runPromise(
      publishSnapshot(fixture.bucket, {
        source,
        types: [type],
        entries: [entry(0, "public"), entry(1, "dm")],
        version: 4,
      }),
    ),
  ).rejects.toThrow("Injected R2 failure");
  expect(fixture.objects.has(keys.publicIndex)).toBe(true);
  expect(fixture.objects.has(keys.manifest)).toBe(false);
  expect(fixture.writes).not.toContain(keys.manifest);
});
