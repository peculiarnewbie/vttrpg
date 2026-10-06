import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { SourceInput, SystemInput } from "../corpus-rpc";
import { typeError } from "../compendium-rules";
import { licenceError } from "../licence";
import { layoutLimitsError } from "../template-io";
import { chooseEntryType, chooseTarget } from "../builder";
import { exprRefs, parseExpr } from "../derived";
import { notationRefs, parseNotation } from "../dice-notation";
import { allBlocks } from "../layout-edit";
import { layoutProblems } from "../sheet-refs";
import { SheetLayout, isKnownPart } from "../sheet-layout";
import { firstPartySystems, gameSystems, presetSystems } from "./index";

it("names every system and id once, and each layout after its own system", () => {
  expect(new Set(gameSystems.map((item) => item.system.id)).size).toBe(gameSystems.length);
  expect(new Set(gameSystems.map((item) => item.system.name)).size).toBe(gameSystems.length);
  for (const { system } of gameSystems)
    for (const layout of system.layouts ?? []) expect(layout.system).toBe(system.name);
});

it("marks systems without an open licence as unofficial", () => {
  for (const system of presetSystems) expect(system.description).toMatch(/^Unofficial /);
});

describe.each(firstPartySystems.map((item) => [item.system.name, item] as const))(
  "%s library",
  (_name, { system, source }) => {
    it("decodes as a corpus source for its system", () => {
      expect(() => Schema.decodeUnknownSync(SourceInput)(source)).not.toThrow();
      expect(source.systemId).toBe(system.id);
    });
    it("carries a valid text licence with attribution", () => {
      expect(licenceError(source.licence)).toBeUndefined();
      expect(source.licence.attribution).toMatch(/licen[cs]ed/i);
    });
  },
);

describe.each(gameSystems.map((item) => [item.system.name, item] as const))(
  "%s",
  (_name, { system }) => {
    it("decodes as a corpus system", () => {
      expect(() => Schema.decodeUnknownSync(SystemInput)(system)).not.toThrow();
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
    it("has builders whose choices come from real reference fields of its own types", () => {
      const types = new Map(system.entryTypes.map((type) => [type.id, type]));
      for (const layout of system.layouts ?? []) {
        // The reference field `from.field` on the entry type chosen at `from.entry`.
        const reference = (from: { entry: string; field: string }) => {
          const block = chooseTarget(layout, from.entry);
          const field =
            block?.type === "entry"
              ? types.get(block.entryType)?.fields.find((item) => item.key === from.field)
              : undefined;
          expect(field?.kind, `${layout.name}: ${from.entry}.${from.field}`).toBe("reference");
          return field?.kind === "reference" ? (field.ref?.typeIds ?? []) : [];
        };
        for (const part of (layout.builder?.steps.flatMap((step) => step.parts) ?? []).filter(
          isKnownPart,
        )) {
          if (part.type === "choose") {
            const target = chooseTarget(layout, part.key);
            expect(target, `${layout.name}: choose ${part.key}`).toBeDefined();
            const typeId = chooseEntryType(target!);
            expect([...types.keys()]).toContain(typeId);
            if (part.from) expect(reference(part.from)).toContain(typeId);
          }
          if (part.type === "tables" && part.from)
            for (const typeId of reference(part.from))
              expect(
                types.get(typeId)?.fields.some((field) => field.kind === "oracle"),
                `${layout.name}: ${typeId} has an oracle field`,
              ).toBe(true);
        }
      }
    });
    it("reads only real fields of the entries its layouts choose", () => {
      const types = new Map(system.entryTypes.map((type) => [type.id, type]));
      for (const layout of system.layouts ?? []) {
        const entryTypes = new Map(
          allBlocks(layout).flatMap((block) =>
            block.type === "entry" ? [[block.key, block.entryType] as const] : [],
          ),
        );
        const builderFormulas = (layout.builder?.steps ?? []).flatMap((step) => [
          step.when ?? "",
          step.done ?? "",
          ...step.parts
            .filter(isKnownPart)
            .flatMap((part) => [
              part.when ?? "",
              ...(part.type === "show" ? part.items.map((item) => item.expr) : []),
              ...(part.type === "budget" ? [part.spent, part.total] : []),
            ]),
        ]);
        const formulas = [
          ...(layout.derived ?? []).map((item) => item.expr),
          ...allBlocks(layout).flatMap((block) =>
            block.type === "trackers"
              ? block.items.flatMap((item) => [item.maxFrom ?? ""])
              : block.type === "list"
                ? block.columns.map((column) => column.expr ?? "")
                : [],
          ),
          ...builderFormulas,
        ];
        const rolls = allBlocks(layout).flatMap((block) =>
          block.type === "trackers" || block.type === "stats"
            ? block.items.flatMap((item) => (item.roll ? [item.roll] : []))
            : block.type === "rolls"
              ? block.items.map((item) => item.dice)
              : [],
        );
        const refs = [
          ...formulas.flatMap((formula) => {
            const parsed = formula.trim() ? parseExpr(formula) : undefined;
            return parsed?.ok ? exprRefs(parsed.value) : [];
          }),
          ...rolls.flatMap((dice) => {
            const parsed = parseNotation(dice);
            return parsed.ok ? notationRefs(parsed.value) : [];
          }),
        ];
        for (const ref of refs) {
          const typeId = entryTypes.get(ref.key);
          if (!typeId || ref.column === undefined) continue;
          expect(
            types.get(typeId)?.fields.map((field) => field.key),
            `${layout.name}: @${ref.key}.${ref.column}`,
          ).toContain(ref.column);
        }
      }
    });
  },
);
