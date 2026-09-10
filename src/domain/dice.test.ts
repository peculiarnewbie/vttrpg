import { describe, expect, it } from "vitest";
import {
  capDice,
  computeStats,
  countDice,
  evaluateRoll,
  makeResolver,
  parseDiceExpression,
  parseRollCommand,
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

  it("caps the pool at ten dice", () => {
    const parsed = parseDiceExpression("50d6");
    expect(countDice(parsed.dice)).toBe(10);
    expect(parsed.dice).toEqual([{ count: 10, sides: 6 }]);
  });
});

describe("capDice", () => {
  it("clamps across groups and drops the remainder", () => {
    expect(
      capDice([
        { count: 6, sides: 6 },
        { count: 6, sides: 8 },
      ]),
    ).toEqual([
      { count: 6, sides: 6 },
      { count: 4, sides: 8 },
    ]);
  });
});

describe("parseRollCommand", () => {
  it("accepts /roll with or without a space", () => {
    expect(parseRollCommand("/roll 2d6")).toBe("2d6");
    expect(parseRollCommand("/roll2d20")).toBe("2d20");
    expect(parseRollCommand("hello")).toBeNull();
    expect(parseRollCommand("/roll")).toBeNull();
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
