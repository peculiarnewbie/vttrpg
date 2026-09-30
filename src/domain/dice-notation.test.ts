import { describe, expect, it } from "vitest";
import {
  DICE_LIMITS,
  formatNotation,
  notationRefs,
  parseNotation,
  rollNotation,
  rollText,
} from "./dice-notation";
import type { Notation, RefLookup } from "./dice-notation";
import type { RollResult } from "./schemas";

const parse = (input: string): Notation => {
  const parsed = parseNotation(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const roll = (input: string, options: Parameters<typeof rollText>[1] = {}): RollResult => {
  const result = rollText(input, options);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const sequence = (...values: number[]) => {
  let index = 0;
  return () => {
    const value = values[index++];
    if (value === undefined) throw new Error("RNG sequence exhausted");
    return value;
  };
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const lookup: RefLookup = ({ key, column }) => {
  const values: Record<string, number> = {
    level: 3.9,
    hunt: 3,
    zero: 0,
    negative: -2.4,
    bonus: -1.2,
    "row.bonus": 2.9,
  };
  const name = column === undefined ? key : `${key}.${column}`;
  return name in values ? { value: values[name], label: `Label ${name}` } : undefined;
};

describe("parseNotation", () => {
  it("parses dice, omitted counts, percentile dice, and signs", () => {
    expect(parse("+ D20 - 2d6 + d% - 4")).toEqual({
      groups: [
        {
          terms: [
            { kind: "dice", sign: 1, count: { kind: "fixed", value: 1 }, sides: 20 },
            { kind: "dice", sign: -1, count: { kind: "fixed", value: 2 }, sides: 6 },
            { kind: "dice", sign: 1, count: { kind: "fixed", value: 1 }, sides: 100 },
            { kind: "number", sign: -1, value: 4 },
          ],
        },
      ],
    });
    expect(formatNotation(parse("-d6+0"))).toBe("-1d6 + 0");
  });

  it("parses every suffix case-insensitively and makes keep counts explicit", () => {
    expect(formatNotation(parse("4D6KH3 + 2d8KL + d20ADV + d20DIS"))).toBe(
      "4d6kh3 + 2d8kl1 + 1d20adv + 1d20dis",
    );
    expect(formatNotation(parse("0d6Z + 3d6zKH"))).toBe("0d6z + 3d6kh1z");
    expect(formatNotation(parse("2d6kl0"))).toBe("2d6kl0");
  });

  it("parses plain and braced refs, columns and computed counts", () => {
    const notation = parse(
      "(@Hunt)d6khz + @row.bonus - @{hp-max} | @{inventory-list.item-weight} + @Hunt",
    );
    expect(formatNotation(notation)).toBe(
      "(@Hunt)d6kh1z + @row.bonus - @{hp-max} | @{inventory-list.item-weight} + @Hunt",
    );
    expect(notationRefs(notation)).toEqual([
      { key: "Hunt" },
      { key: "row", column: "bonus" },
      { key: "hp-max" },
      { key: "inventory-list", column: "item-weight" },
      { key: "Hunt" },
    ]);
    expect(formatNotation(parse("@{simple} + @{some key}"))).toBe("@simple + @{some key}");
  });

  it("accepts whitespace between tokens", () => {
    expect(parse("\t( @level ) D 6 KH 2 Z \n+ @row . bonus")).toEqual(
      parse("(@level)d6kh2z+@row.bonus"),
    );
  });

  it.each([
    "",
    " ",
    "|d6",
    "d6|",
    "d6||d8",
    "2d6+",
    "2d6-",
    "1d20 x",
    "d",
    "@",
    "@{}",
    "@{ }",
    "@1",
    "@a.",
    "@a.b.c",
    "@{a.b.c}",
    "@{.a}",
    "@{a.}",
    "@{a",
    "@{{a}}",
    "d0",
    "d1001",
    "101d6",
    "d-6",
    "2.5d6",
    "2d6*3",
    "d6!",
    "++d6",
    "d6+-1",
    "d6--1",
    "()d6",
    "(3)d6",
    "(@a+1)d6",
    "(@a)d",
    "(@a)d6+",
    "(@a d6",
    "(@a)",
    "d6 d8",
    "5 6",
    "d6khkl",
    "d6advdis",
    "d6khadv",
    "d6khkh",
    "d6zz",
    "1000001",
    "d6kh1000001",
  ])("rejects malformed or unsupported notation %j", (input) => {
    const result = parseNotation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at \d+/);
  });

  it("reports useful positions and bounds", () => {
    expect(parseNotation("1d20 x")).toEqual({ ok: false, error: "Unexpected “x” at 5" });
    expect(parseNotation("2d6+")).toEqual({ ok: false, error: "Expected “d” at 4" });
    expect(parseNotation("d0")).toEqual({ ok: false, error: "Dice need at least 1 side at 1" });
    expect(parseNotation(" ".repeat(201))).toEqual({ ok: false, error: "At most 200 characters" });
    expect(parseNotation("1|2|3|4|5")).toMatchObject({ ok: false });
    expect(parseNotation(Array.from({ length: 21 }, () => "1").join("+"))).toMatchObject({
      ok: false,
    });
    expect(parseNotation("100d1000+1000000|0|0|0").ok).toBe(true);
    expect(parseNotation(Array.from({ length: 20 }, () => "1").join("+")).ok).toBe(true);
    expect(parseNotation("1".padEnd(200, " ")).ok).toBe(true);
  });
});

describe("rollNotation", () => {
  it("rolls basic and percentile dice within their ranges", () => {
    expect(roll("d6+d%", { rng: sequence(0, 0.99999) })).toEqual({
      notation: "1d6 + 1d100",
      dice: [
        { sides: 6, results: [1] },
        { sides: 100, results: [100] },
      ],
      modifiers: [],
      total: 101,
    });
  });

  it("subtracts negative dice terms", () => {
    expect(roll("1d20-1d4", { rng: sequence(0.999, 0.999) })).toEqual({
      notation: "1d20 - 1d4",
      dice: [
        { sides: 20, results: [20] },
        { sides: 4, results: [4], negative: true },
      ],
      modifiers: [],
      total: 16,
    });
    expect(roll("-2d6kh1", { rng: sequence(0, 0.9) }).total).toBe(-6);
  });

  it.each([
    ["4d6kh3", [false, true, true, true], 13],
    ["4d6kl2", [true, true, false, false], 3],
    ["4d6kh", [false, false, false, true], 6],
    ["4d6kl0", [false, false, false, false], 0],
  ])("keeps the selected results in original order for %s", (input, kept, total) => {
    const result = roll(input, { rng: sequence(0, 0.2, 0.7, 0.99) });
    expect(result.dice).toEqual([{ sides: 6, results: [1, 2, 5, 6], kept }]);
    expect(result.total).toBe(total);
  });

  it("breaks keep ties by original index without keeping too many dice", () => {
    expect(roll("3d6kh2", { rng: () => 0.5 }).dice[0].kept).toEqual([true, true, false]);
    expect(roll("3d6kl1", { rng: () => 0.5 }).dice[0].kept).toEqual([true, false, false]);
  });

  it("omits kept when no dice are dropped", () => {
    expect(roll("2d6kh2+2d6kl9", { rng: () => 0 }).dice).toEqual([
      { sides: 6, results: [1, 1] },
      { sides: 6, results: [1, 1] },
    ]);
  });

  it.each([
    ["1d20adv", [1, 20], [false, true], 20],
    ["1d20dis", [1, 20], [true, false], 1],
    ["2d6adv", [1, 4, 6], [false, true, true], 10],
    ["2d6dis", [1, 4, 6], [true, true, false], 5],
  ])("rolls one extra die for %s", (input, results, kept, total) => {
    const rng = results.length === 2 ? sequence(0, 0.999) : sequence(0, 0.5, 0.999);
    const result = roll(input, { rng });
    expect(result.dice[0]).toMatchObject({ results, kept });
    expect(result.total).toBe(total);
  });

  it.each(["0d6z", "0d6khz", "(@zero)d6khz", "(@negative)d6kh2z"])(
    "uses the lowest of two dice for zero pools: %s",
    (input) => {
      expect(roll(input, { lookup, rng: sequence(0.999, 0) }).dice).toEqual([
        { sides: 6, results: [6, 1], kept: [false, true] },
      ]);
      expect(roll(input, { lookup, rng: sequence(0.999, 0) }).total).toBe(1);
    },
  );

  it("ignores z for positive counts and preserves the requested keep rule", () => {
    const result = roll("(@hunt)d6khz", { lookup, rng: sequence(0, 0.5, 0.999) });
    expect(result.dice).toEqual([{ sides: 6, results: [1, 4, 6], kept: [false, false, true] }]);
    expect(result.total).toBe(6);
    expect(roll("2d6z", { rng: () => 0 }).dice).toEqual([{ sides: 6, results: [1, 1] }]);
  });

  it("treats z independently of the keep or advantage suffix", () => {
    for (const suffix of ["kl2z", "advz", "disz"]) {
      expect(roll(`0d6${suffix}`, { rng: sequence(0, 0.999) }).dice).toEqual([
        { sides: 6, results: [1, 6], kept: [true, false] },
      ]);
    }
    expect(roll("1d6advz", { rng: sequence(0, 0.999) }).total).toBe(6);
    expect(roll("2d6klz", { rng: sequence(0, 0.999) }).total).toBe(1);
  });

  it("floors computed counts and clamps negative counts to zero", () => {
    expect(roll("(@level)d6", { lookup, rng: () => 0.999 }).total).toBe(18);
    expect(roll("(@negative)d6+0d8", { lookup }).dice).toEqual([
      { sides: 6, results: [] },
      { sides: 8, results: [] },
    ]);
    expect(roll("0d6adv", { rng: () => 0 }).dice).toEqual([
      { sides: 6, results: [1], kept: [false] },
    ]);
  });

  it("combines static parts, floors each ref before applying its sign and preserves labels", () => {
    const result = roll("5+@row.bonus-2-@bonus+@row.bonus", { lookup });
    expect(result.dice).toEqual([]);
    expect(result.modifiers).toEqual([
      { label: "static", value: 3 },
      { label: "Label row.bonus", value: 2 },
      { label: "Label bonus", value: 2 },
      { label: "Label row.bonus", value: 2 },
    ]);
    expect(result.total).toBe(9);
    expect(roll("2-2+@bonus", { lookup }).modifiers).toEqual([{ label: "Label bonus", value: -2 }]);
    expect(roll("-5+2").total).toBe(-3);
    expect(roll("0")).toEqual({ notation: "0", dice: [], modifiers: [], total: 0 });
  });

  it.each(["@missing", "(@missing)d6", "@row.missing", "@{hp-max}"])(
    "reports unknown refs for %s",
    (input) => {
      const ref = notationRefs(parse(input))[0];
      const expected =
        ref.key === "hp-max" ? "@{hp-max}" : `@${ref.key}${ref.column ? `.${ref.column}` : ""}`;
      expect(rollText(input)).toEqual({ ok: false, error: `Unknown value ${expected}` });
      expect(rollText(input, { lookup })).toEqual({
        ok: false,
        error: `Unknown value ${expected}`,
      });
    },
  );

  it("keeps refs case-sensitive", () => {
    expect(rollText("@Level", { lookup })).toEqual({ ok: false, error: "Unknown value @Level" });
  });

  it("rejects non-finite refs and oversized modifier values", () => {
    for (const value of [NaN, Infinity, -Infinity, 1000001, -1000001]) {
      expect(rollText("@value", { lookup: () => ({ value, label: "Value" }) }).ok).toBe(false);
    }
    expect(roll("@value", { lookup: () => ({ value: -1000000, label: "Value" }) }).total).toBe(
      -1000000,
    );
    expect(rollText("(@value)d6", { lookup: () => ({ value: Infinity, label: "Value" }) }).ok).toBe(
      false,
    );
  });

  it("rolls groups independently and repeats the first group at the top level", () => {
    const result = roll("d20+5 | 2d6-3 | @row.bonus", { lookup, rng: () => 0.999 });
    expect(result.groups).toEqual([
      {
        notation: "1d20 + 5",
        dice: [{ sides: 20, results: [20] }],
        modifiers: [{ label: "static", value: 5 }],
        total: 25,
      },
      {
        notation: "2d6 - 3",
        dice: [{ sides: 6, results: [6, 6] }],
        modifiers: [{ label: "static", value: -3 }],
        total: 9,
      },
      {
        notation: "@row.bonus",
        dice: [],
        modifiers: [{ label: "Label row.bonus", value: 2 }],
        total: 2,
      },
    ]);
    expect(result.notation).toBe("1d20 + 5 | 2d6 - 3 | @row.bonus");
    expect(result.total).toBe(25);
    expect(result.dice).toEqual(result.groups?.[0].dice);
    expect(result.modifiers).toEqual(result.groups?.[0].modifiers);
    expect(roll("d6").groups).toBeUndefined();
  });

  it.each(["100d6+d6", "100d6adv", "100d6|d6", "99d6+0d6z", "(@big)d6"])(
    "limits actual dice across all groups: %s",
    (input) => {
      let draws = 0;
      expect(
        rollText(input, {
          lookup: () => ({ value: 101, label: "Big" }),
          rng: () => {
            draws++;
            return 0;
          },
        }),
      ).toEqual({ ok: false, error: "At most 100 dice per roll" });
      expect(draws).toBe(0);
    },
  );

  it("accepts exactly 100 dice, including extra and zero-pool dice", () => {
    for (const input of ["100d6", "99d6adv", "98d6+0d6z", "50d6|50d8"]) {
      const result = roll(input, { rng: () => 0 });
      const groups = result.groups ?? [result];
      expect(
        groups.flatMap((group) => group.dice).reduce((sum, die) => sum + die.results.length, 0),
      ).toBe(DICE_LIMITS.dice);
    }
    expect(rollNotation(parse("d6"), { rng: () => 0 }).ok).toBe(true);
  });

  it("has a seeded 1d6 distribution covering every face", () => {
    const rng = mulberry32(4242);
    const counts = Array<number>(6).fill(0);
    const notation = parse("1d6");
    for (let index = 0; index < 6000; index++) {
      const result = rollNotation(notation, { rng });
      if (!result.ok) throw new Error(result.error);
      expect(result.value.total).toBeGreaterThanOrEqual(1);
      expect(result.value.total).toBeLessThanOrEqual(6);
      counts[result.value.total - 1]++;
    }
    for (const count of counts) expect(count).toBeGreaterThan(800);
  });
});

describe("formatNotation", () => {
  it("keeps canonical output parseable at the length limit", () => {
    const group = Array.from({ length: 16 }, () => "d%").join("+");
    const input = Array.from({ length: 4 }, () => group).join("|");
    expect(input.length).toBeLessThanOrEqual(DICE_LIMITS.length);
    const ast = parse(input);
    const canonical = formatNotation(ast);
    expect(canonical.length).toBeLessThanOrEqual(DICE_LIMITS.length);
    expect(parse(canonical)).toEqual(ast);
    expect(formatNotation(parse(canonical))).toBe(canonical);
    const keeps = Array.from({ length: 20 }, () => "d6kh").join("+");
    const longKeeps = `${keeps}|${keeps}`;
    expect(parse(formatNotation(parse(longKeeps)))).toEqual(parse(longKeeps));
  });
  it("round-trips a few hundred seeded random valid notations", () => {
    const rng = mulberry32(91823);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(rng() * values.length)];
    const refs = [
      "@str_mod",
      "@row.bonus",
      "@inventory.weight",
      "@{hp-max}",
      "@{my-list.some column}",
    ];
    const suffixes = [
      "",
      "KH",
      "kl",
      "kh0",
      "kl2",
      "adv",
      "DIS",
      "z",
      "khz",
      "zkh3",
      "klz",
      "advz",
      "disz",
    ];
    for (let sample = 0; sample < 500; sample++) {
      const groups = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
        const terms = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
          const kind = Math.floor(rng() * 3);
          if (kind === 0) return String(Math.floor(rng() * 100));
          if (kind === 1) return pick(refs);
          const count = pick(["", "0", "1", "3", "12", `(${pick(refs)})`]);
          return `${count}${pick(["d", "D"])}${pick(["6", "20", "%", "1000"])}${pick(suffixes)}`;
        });
        return pick(["", "+", "-"]) + terms.join(pick([" + ", "-", "+", " - "]));
      });
      const input = groups.join(pick(["|", " | "]));
      const ast = parse(input);
      const canonical = formatNotation(ast);
      expect(parse(canonical)).toEqual(ast);
      expect(formatNotation(parse(canonical))).toBe(canonical);
    }
  });
});
