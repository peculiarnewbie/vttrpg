import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { SourceInput, SystemInput } from "../corpus-rpc";
import { typeError } from "../compendium-rules";
import { licenceError } from "../licence";
import { layoutLimitsError } from "../template-io";
import { layoutProblems } from "../sheet-refs";
import { SheetLayout } from "../sheet-layout";
import { firstPartySystems } from "./index";

describe.each(firstPartySystems.map((item) => [item.system.name, item] as const))(
  "%s",
  (_name, { system, source }) => {
    it("decodes as a corpus system and source", () => {
      expect(() => Schema.decodeUnknownSync(SystemInput)(system)).not.toThrow();
      expect(() => Schema.decodeUnknownSync(SourceInput)(source)).not.toThrow();
      expect(source.systemId).toBe(system.id);
    });
    it("has entry types the compendium accepts", () => {
      expect(new Set(system.entryTypes.map((type) => type.id)).size).toBe(system.entryTypes.length);
      for (const type of system.entryTypes)
        expect(typeError(type, system.entryTypes)).toBeUndefined();
    });
    it("has sheet layouts that decode, fit the limits and only refer to their own keys", () => {
      expect(system.layouts?.length).toBeGreaterThan(0);
      for (const layout of system.layouts ?? []) {
        expect(() => Schema.decodeUnknownSync(SheetLayout)(layout)).not.toThrow();
        expect(layoutLimitsError(layout)).toBeUndefined();
        expect(layoutProblems(layout)).toEqual([]);
      }
    });
    it("lists from the library and linked entries use the system's own entry types", () => {
      const ids = new Set(system.entryTypes.map((type) => type.id));
      const used = (system.layouts ?? []).flatMap((layout) =>
        layout.pages.flatMap((page) =>
          page.blocks.flatMap((block) => (block.type === "group" ? block.blocks : [block])),
        ),
      );
      for (const block of used) {
        if (block.type === "entry") expect(ids).toContain(block.entryType);
        if (block.type === "list" && block.source) expect(ids).toContain(block.source.entryType);
      }
    });
    it("carries a valid text licence with attribution", () => {
      expect(licenceError(source.licence)).toBeUndefined();
      expect(source.licence.attribution).toMatch(/licen[cs]ed/i);
    });
  },
);
