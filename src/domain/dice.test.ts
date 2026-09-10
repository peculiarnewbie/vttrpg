import { describe, expect, it } from "vitest";
import {
  computeStats,
  evaluateRoll,
  makeResolver,
  parseDiceExpression,
  rollExpression,
} from "./dice";
import type { RollDefinition, StatDefinition } from "./schemas";

const max = () => 0.9999;

describe("parseDiceExpression", () => {
  it("parses counts and sides", () => {
    expect(parseDiceExpression("2d6")).toEqual({ dice: [{ count: 2, sides: 6 }], staticBonus: 0 });
    expect(parseDiceExpression("d20")).toEqual({ dice: [{ count: 1, sides: 20 }], staticBonus: 0 });
    expect(parseDiceExpression("2d6 + 1d8 - 1")).toEqual({
      dice: [
        { count: 2, sides: 6 },
        { count: 1, sides: 8 },
      ],
      staticBonus: -1,
    });
  });
});

describe("rollExpression", () => {
  it("totals dice and static bonus", () => {
    const result = rollExpression("2d6+3", max);
    expect(result.total).toBe(6 + 6 + 3);
    expect(result.dice).toEqual([{ sides: 6, results: [6, 6] }]);
  });
});

describe("computeStats", () => {
  it("resolves field and stat references, with stacking", () => {
    const stats: StatDefinition[] = [
      { id: "str", label: "STR", modifiers: [{ kind: "field", fieldId: "strScore" }] },
      { id: "strMod", label: "STR mod", modifiers: [{ kind: "stat", statId: "str" }] },
      { id: "prof", label: "Prof", base: 2, modifiers: [] },
      {
        id: "save",
        label: "Save",
        base: 1,
        modifiers: [
          { kind: "stat", statId: "strMod" },
          { kind: "static", value: 1 },
        ],
      },
    ];
    const values = { strScore: 16 };
    const resolved = computeStats(stats, values);
    expect(resolved.str).toBe(16);
    expect(resolved.strMod).toBe(16);
    expect(resolved.prof).toBe(2);
    expect(resolved.save).toBe(18);
  });

  it("does not infinite-loop on cycles", () => {
    const stats: StatDefinition[] = [
      { id: "a", label: "A", modifiers: [{ kind: "stat", statId: "b" }] },
      { id: "b", label: "B", modifiers: [{ kind: "stat", statId: "a" }] },
    ];
    expect(() => computeStats(stats, {})).not.toThrow();
  });
});

describe("evaluateRoll", () => {
  it("combines dice and stacked modifiers", () => {
    const definition: RollDefinition = {
      id: "attack",
      label: "Attack",
      dice: [{ count: 1, sides: 20 }],
      modifiers: [
        { kind: "static", value: 2 },
        { kind: "stat", statId: "strMod" },
      ],
      visibility: "public",
    };
    const resolver = makeResolver({ str: 4 }, { strMod: 4 });
    const result = evaluateRoll(definition, resolver, max);
    expect(result.total).toBe(20 + 2 + 4);
    expect(result.modifiers.map((modifier) => modifier.value)).toEqual([2, 4]);
  });
});
