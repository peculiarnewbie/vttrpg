import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  CORPUS_API_VERSION,
  CorpusCall,
  SourceCall,
  SaveSystemCall,
  CreateSourceCall,
  SaveEntriesCall,
  DeleteEntriesCall,
  ManifestCall,
} from "../../../src/domain/corpus-rpc";
import type { CompendiumEntry, EntryType, SaveEntryInput } from "../../../src/domain/compendium";
import { encodeBodies, decodeBodies } from "../../../src/domain/snapshot";
import type { CorpusError } from "../../../src/domain/corpus-errors";
import { runReply } from "./effects";
import {
  decodeCall,
  safeId,
  validateBatch,
  validateSourceEntry,
  validateSystem,
  validatePublishedEntrySize,
} from "./validation";

const type: EntryType = {
  id: "spell",
  name: "Spell",
  fields: [{ key: "level", label: "Level", kind: "number" }],
};
const entry: SaveEntryInput = {
  typeId: "spell",
  name: "Invented lantern",
  tags: [],
  body: "Synthetic test text.",
  fields: { level: 1 },
  visibility: "public",
};
const reply = <A>(effect: Effect.Effect<A, CorpusError>) => runReply(effect, Effect.runPromiseExit);
const invalid = { ok: false, error: { _tag: "CorpusInvalid" } };

describe("corpus RPC validation", () => {
  it("rejects unsupported versions and missing/blank accounts on every envelope", async () => {
    const schemas = [
      CorpusCall,
      SourceCall,
      SaveSystemCall,
      CreateSourceCall,
      SaveEntriesCall,
      DeleteEntriesCall,
      ManifestCall,
    ];
    for (const schema of schemas) {
      await expect(
        reply(decodeCall(schema, { apiVersion: CORPUS_API_VERSION + 1, accountId: "owner" })),
      ).resolves.toMatchObject(invalid);
      for (const accountId of ["", "  "])
        await expect(
          reply(decodeCall(schema, { apiVersion: CORPUS_API_VERSION, accountId })),
        ).resolves.toMatchObject(invalid);
    }
    await expect(
      reply(
        decodeCall(SaveEntriesCall, {
          apiVersion: CORPUS_API_VERSION,
          accountId: "owner",
          sourceId: "book",
          entries: [{ ...entry, fields: { level: null } }],
        }),
      ),
    ).resolves.toMatchObject(invalid);
    await expect(
      reply(decodeCall(CorpusCall, { apiVersion: CORPUS_API_VERSION, accountId: "owner" })),
    ).resolves.toMatchObject({ ok: true });
  });

  it("checks source identity independently of the shared world field validation", async () => {
    await expect(
      reply(validateSourceEntry("book", { ...entry, id: "book/spell/lantern" }, type)),
    ).resolves.toMatchObject({ ok: true });
    for (const input of [
      { ...entry, id: "elsewhere/spell/lantern" },
      { ...entry, id: "book/item/lantern" },
      { ...entry, fields: { level: "bad" } },
      { ...entry, body: "x".repeat(12001) },
    ])
      await expect(reply(validateSourceEntry("book", input, type))).resolves.toMatchObject(invalid);
  });

  it("bounds identities, batches and type definitions", async () => {
    for (const id of ["world", "../book", "Book", "", "a".repeat(61)])
      await expect(reply(safeId(id))).resolves.toMatchObject(invalid);
    await expect(reply(safeId("my-library_2"))).resolves.toMatchObject({ ok: true });
    await expect(
      reply(validateBatch(Array.from({ length: 101 }, () => entry))),
    ).resolves.toMatchObject(invalid);
    await expect(
      reply(validateSystem({ id: "game", name: "Game", entryTypes: [type, type] })),
    ).resolves.toMatchObject(invalid);
  });

  it("rejects combined body/licence bytes and reserves maximum publication metadata", async () => {
    const licence = {
      id: "CC0-1.0",
      name: "CC0 1.0",
      attribution: "a".repeat(8000),
      shareAlike: false,
    };
    const saved: CompendiumEntry = {
      ...entry,
      id: "book/spell/lantern",
      body: "é".repeat(3750),
      updatedAt: "2026-09-30T00:00:00.000Z",
      rev: 1,
    };
    await expect(reply(validateSourceEntry("book", saved, type))).resolves.toMatchObject({
      ok: true,
    });
    await expect(reply(validatePublishedEntrySize(saved, licence))).resolves.toMatchObject({
      ok: true,
    });
    const published = {
      ...saved,
      rev: Number.MAX_SAFE_INTEGER,
      licence,
      sourceVersion: 2147483647,
      sourceRev: Number.MAX_SAFE_INTEGER,
    };
    expect((await decodeBodies(await encodeBodies([published])))[0]).toEqual(published);
    const oversized = { ...saved, body: "x".repeat(10000) };
    await expect(reply(validateSourceEntry("book", oversized, type))).resolves.toMatchObject({
      ok: true,
    });
    await expect(reply(validatePublishedEntrySize(oversized, licence))).resolves.toMatchObject(
      invalid,
    );
  });
});
