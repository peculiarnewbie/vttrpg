// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompendiumEntry, SaveEntryInput } from "../../../src/domain/compendium";
import type { CorpusSource, CorpusSystem } from "../../../src/domain/corpus-rpc";
import { decodeBodies, decodeIndex, type SnapshotManifest } from "../../../src/domain/snapshot";
import { startTabletop, type Tabletop } from "../../../src/test/miniflare";

const owner = { apiVersion: 1, accountId: "owner" };
const other = { apiVersion: 1, accountId: "other" };
const system = {
  id: "invented",
  name: "Invented game",
  entryTypes: [{ id: "spell", name: "Spell", fields: [] }],
};
const licence = {
  id: "CC0-1.0",
  name: "CC0 1.0",
  attribution: "Original synthetic test fixtures.",
  shareAlike: false,
};
const input: SaveEntryInput = {
  typeId: "spell",
  name: "Invented lantern",
  tags: ["synthetic"],
  body: "Original synthetic test text.",
  fields: {},
  visibility: "public",
};

describe("corpus service RPC and immutable publication", () => {
  let app: Tabletop;
  beforeAll(async () => {
    app = await startTabletop({ corpus: true });
  }, 30000);
  afterAll(async () => {
    await app?.dispose();
  });

  it("validates every public envelope and rejects unknown API versions", async () => {
    for (const method of [
      "listSystems",
      "saveSystem",
      "listSources",
      "createSource",
      "getSource",
      "saveEntries",
      "deleteEntries",
      "publish",
      "getLatest",
      "getManifest",
    ]) {
      await expect(app.corpusCall(method, { ...owner, apiVersion: 2 })).rejects.toThrow();
      await expect(app.corpusCall(method, { ...owner, accountId: "" })).rejects.toThrow();
    }
    await expect(
      app.corpusCall("saveSystem", { ...owner, system: { ...system, id: "world" } }),
    ).rejects.toThrow();
  });

  it("enforces registry ownership and source identity without altering existing sources", async () => {
    await app.corpusCall("saveSystem", { ...owner, system });
    await expect(
      app.corpusCall("saveSystem", { ...other, system: { ...system, name: "Changed" } }),
    ).rejects.toThrow("owner");
    const systems = await app.corpusCall<CorpusSystem[]>("listSystems", other);
    expect(systems[0].name).toBe(system.name);
    await app.corpusCall("createSource", {
      ...owner,
      source: {
        id: "book",
        systemId: system.id,
        name: "Synthetic book",
        licence,
        visibility: "public",
      },
    });
    await expect(
      app.corpusCall("createSource", {
        ...other,
        source: {
          id: "book",
          systemId: system.id,
          name: "Replacement",
          licence,
          visibility: "private",
        },
      }),
    ).rejects.toThrow("immutable");
    expect(await app.corpusCall<CorpusSource[]>("listSources", other)).toEqual([]);
    await expect(app.corpusCall("getSource", { ...other, sourceId: "book" })).rejects.toThrow();
    expect(await app.corpusCall("getLatest", { ...owner, sourceId: "book" })).toBeNull();
    await expect(
      app.corpusCall("saveEntries", { ...other, sourceId: "book", entries: [input] }),
    ).rejects.toThrow("owner");
    await expect(app.corpusCall("publish", { ...other, sourceId: "book" })).rejects.toThrow(
      "owner",
    );
  });

  it("keeps stable ids/revisions and freezes public/DM data and type definitions", async () => {
    const call = { ...owner, sourceId: "book" };
    const entries = await app.corpusCall<CompendiumEntry[]>("saveEntries", {
      ...call,
      entries: [input, { ...input, name: "Hidden synthetic note", visibility: "dm" }],
    });
    expect(entries[0].id).toBe("book/spell/invented-lantern");
    expect(entries[1].rev).toBeGreaterThan(entries[0].rev!);
    await expect(
      app.corpusCall("saveEntries", { ...call, entries: [{ ...input, id: "other/spell/wrong" }] }),
    ).rejects.toThrow("belong");
    await expect(
      app.corpusCall("deleteEntries", { ...call, ids: ["elsewhere/spell/wrong"] }),
    ).rejects.toThrow("another source");
    const manifest = await app.corpusCall<SnapshotManifest>("publish", call);
    expect(manifest.version).toBe(1);
    const bucket = await app.mf.getR2Bucket("CORPUS_BUCKET", "corpus");
    const publicIndex = await bucket.get(manifest.publicIndex.key);
    const publicRows = await decodeIndex(
      new Uint8Array(await publicIndex!.arrayBuffer()),
      "public",
    );
    expect(publicRows.map((row) => row.id)).toEqual([entries[0].id]);
    const dmIndex = await bucket.get(manifest.dmIndex.key);
    expect(
      (await decodeIndex(new Uint8Array(await dmIndex!.arrayBuffer()), "dm")).map((row) => row.id),
    ).toEqual([entries[1].id]);
    const chunk = manifest.bodyChunks.find((item) => item.visibility === "public")!;
    const original = await bucket.get(chunk.file.key);
    const originalBytes = new Uint8Array(await original!.arrayBuffer());
    const changed = await app.corpusCall<CompendiumEntry[]>("saveEntries", {
      ...call,
      entries: [{ ...input, id: entries[0].id, name: "Renamed synthetic lantern" }],
    });
    expect(changed[0].id).toBe(entries[0].id);
    expect(changed[0].rev).toBeGreaterThan(entries[1].rev!);
    await app.corpusCall("saveSystem", {
      ...owner,
      system: { ...system, entryTypes: [{ ...system.entryTypes[0], name: "Renamed type" }] },
    });
    const latest = await app.corpusCall<SnapshotManifest>("getLatest", {
      ...other,
      sourceId: "book",
    });
    expect(latest.types[0].name).toBe("Spell");
    expect((await decodeBodies(originalBytes))[0]).toMatchObject({
      name: input.name,
      licence,
      sourceVersion: 1,
      sourceRev: entries[0].rev,
    });
    expect(
      await app.corpusCall("getManifest", { ...other, sourceId: "book", version: 2 }),
    ).toBeNull();
  });

  it("does not reuse a version after registry commit fails, preserving the old publication", async () => {
    const db = await app.mf.getD1Database("CORPUS_DB", "corpus");
    await db
      .prepare(
        "CREATE TRIGGER fail_version BEFORE INSERT ON versions WHEN NEW.source_id = 'book' AND NEW.version = 2 BEGIN SELECT RAISE(ABORT, 'Injected registration failure'); END",
      )
      .run();
    const call = { ...owner, sourceId: "book" };
    await expect(app.corpusCall("publish", call)).rejects.toThrow();
    expect((await app.corpusCall<SnapshotManifest>("getLatest", call)).version).toBe(1);
    expect(await app.corpusCall("getManifest", { ...call, version: 2 })).toBeNull();
    await db.prepare("DROP TRIGGER fail_version").run();
    const published = await app.corpusCall<SnapshotManifest>("publish", call);
    expect(published.version).toBe(3);
    const original = await app.corpusCall<SnapshotManifest>("getManifest", { ...call, version: 1 });
    expect(original.types[0].name).toBe("Spell");
    expect(published.types[0].name).toBe("Renamed type");
  });

  it("only exposes private sources to their owner even after publication", async () => {
    await app.corpusCall("createSource", {
      ...owner,
      source: {
        id: "private-book",
        systemId: system.id,
        name: "Private synthetic book",
        licence,
        visibility: "private",
      },
    });
    const call = { ...owner, sourceId: "private-book" };
    await app.corpusCall("saveEntries", { ...call, entries: [input] });
    await app.corpusCall("publish", call);
    expect(
      (await app.corpusCall<CorpusSource[]>("listSources", other)).map((source) => source.id),
    ).toEqual(["book"]);
    for (const method of ["getSource", "getLatest", "getManifest"])
      await expect(
        app.corpusCall(method, { ...other, sourceId: "private-book", version: 1 }),
      ).rejects.toThrow("private");
  });

  it("atomically rejects entries whose combined licence and body exceed the publication limit", async () => {
    const longLicence = { ...licence, attribution: "a".repeat(8000) };
    await app.corpusCall("createSource", {
      ...owner,
      source: {
        id: "size-budget",
        systemId: system.id,
        name: "Size budget fixtures",
        licence: longLicence,
        visibility: "private",
      },
    });
    const call = { ...owner, sourceId: "size-budget" };
    await expect(
      app.corpusCall("saveEntries", {
        ...call,
        entries: [input, { ...input, name: "Too large when licensed", body: "x".repeat(10000) }],
      }),
    ).rejects.toThrow("including licence");
    const saved = await app.corpusCall<CompendiumEntry[]>("saveEntries", {
      ...call,
      entries: [{ ...input, body: "é".repeat(3750) }],
    });
    expect(saved[0].id).toBe("size-budget/spell/invented-lantern");
    expect(saved[0].rev).toBe(1);
    const manifest = await app.corpusCall<SnapshotManifest>("publish", call);
    expect(manifest.entryCount).toBe(1);
    const bucket = await app.mf.getR2Bucket("CORPUS_BUCKET", "corpus");
    const object = await bucket.get(manifest.bodyChunks[0].file.key);
    const published = await decodeBodies(new Uint8Array(await object!.arrayBuffer()));
    expect(published[0]).toMatchObject({
      id: saved[0].id,
      body: saved[0].body,
      licence: longLicence,
    });
    expect(new TextEncoder().encode(JSON.stringify(published[0])).byteLength).toBeLessThanOrEqual(
      16 * 1024,
    );
  });
});
