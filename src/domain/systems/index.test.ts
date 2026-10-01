import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { SourceInput, SystemInput } from "../corpus-rpc";
import { typeError } from "../compendium-rules";
import { licenceError } from "../licence";
import { layoutLimitsError } from "../template-io";
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
    it("has sheet layouts within limits", () => {
      for (const layout of system.layouts ?? []) expect(layoutLimitsError(layout)).toBeUndefined();
    });
    it("carries a valid text licence with attribution", () => {
      expect(licenceError(source.licence)).toBeUndefined();
      expect(source.licence.attribution).toMatch(/licen[cs]ed/i);
    });
  },
);
