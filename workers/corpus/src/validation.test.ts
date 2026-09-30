import { describe, expect, it } from "vitest";
import {
  CorpusCall,
  SourceCall,
  SaveSystemCall,
  CreateSourceCall,
  SaveEntriesCall,
  DeleteEntriesCall,
  ManifestCall,
} from "../../../src/domain/corpus-rpc";
import type { EntryType, SaveEntryInput } from "../../../src/domain/compendium";
import {
  decodeCall,
  safeId,
  validateBatch,
  validateSourceEntry,
  validateSystem,
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

describe("corpus RPC validation", () => {
  it("rejects unsupported versions and missing/blank accounts on every envelope", () => {
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
      expect(() => decodeCall(schema, { apiVersion: 2, accountId: "owner" })).toThrow();
      expect(() => decodeCall(schema, { apiVersion: 1, accountId: "" })).toThrow();
      expect(() => decodeCall(schema, { apiVersion: 1, accountId: "  " })).toThrow();
    }
    expect(() => decodeCall(CorpusCall, { apiVersion: 1, accountId: "  " })).toThrow(
      "authenticated",
    );
    expect(() =>
      decodeCall(SaveEntriesCall, {
        apiVersion: 1,
        accountId: "owner",
        sourceId: "book",
        entries: [{ ...entry, fields: { level: null } }],
      }),
    ).toThrow();
  });

  it("checks source identity independently of the shared world field validation", () => {
    expect(() =>
      validateSourceEntry("book", { ...entry, id: "book/spell/lantern" }, type),
    ).not.toThrow();
    expect(() =>
      validateSourceEntry("book", { ...entry, id: "elsewhere/spell/lantern" }, type),
    ).toThrow("belong");
    expect(() => validateSourceEntry("book", { ...entry, id: "book/item/lantern" }, type)).toThrow(
      "belong",
    );
    expect(() => validateSourceEntry("book", { ...entry, fields: { level: "bad" } }, type)).toThrow(
      "Invalid value",
    );
    expect(() => validateSourceEntry("book", { ...entry, body: "x".repeat(12001) }, type)).toThrow(
      "12000",
    );
  });

  it("bounds identities, batches and type definitions", () => {
    for (const id of ["world", "../book", "Book", "", "a".repeat(61)])
      expect(() => safeId(id)).toThrow();
    expect(() => safeId("my-library_2")).not.toThrow();
    expect(() => validateBatch(Array.from({ length: 101 }, () => entry))).toThrow("100");
    expect(() => validateSystem({ id: "game", name: "Game", entryTypes: [type, type] })).toThrow(
      "unique",
    );
  });
});
