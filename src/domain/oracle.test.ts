import { describe, expect, it } from "vitest";
import { oracleDice, oracleListRows, oracleRow, oracleRows } from "./oracle";

const first = { min: -2, max: 0, text: "First" };
const last = { min: 3, max: 5, text: "Last" };

describe("oracle rows", () => {
  it("sorts a copy, permits gaps and negative bounds, and preserves content", () => {
    const rows = [last, first];
    expect(oracleRows(rows)).toEqual({ ok: true, value: [first, last] });
    expect(rows).toEqual([last, first]);
    expect(oracleRows([{ min: 1, max: 1, text: "  content  " }])).toEqual({
      ok: true,
      value: [{ min: 1, max: 1, text: "  content  " }],
    });
    expect(oracleListRows([first, last])).toEqual([first, last]);
    expect(oracleListRows([first])[0]).not.toBe(first);
  });

  it.each([
    undefined,
    null,
    {},
    "table",
    [null],
    [[]],
    ["row"],
    [{}],
    [{ min: 1.5, max: 2, text: "x" }],
    [{ min: 1, max: 2.5, text: "x" }],
    [{ min: "1", max: 2, text: "x" }],
    [{ min: 1, max: "2", text: "x" }],
    [{ min: NaN, max: 2, text: "x" }],
    [{ min: 1, max: Infinity, text: "x" }],
    [{ min: 2, max: 1, text: "x" }],
    [{ min: 1, max: 2, text: " \n " }],
    [{ min: 1, max: 2, text: 1 }],
    [first, first],
    [{ min: 0, max: 2, text: "x" }, first],
    [{ min: -10, max: 10, text: "x" }, first],
  ])("rejects invalid rows and inclusive overlaps: %j", (value) => {
    expect(oracleRows(value).ok).toBe(false);
  });

  it("accepts empty tables and 200 rows, rejecting 201", () => {
    expect(oracleRows([])).toEqual({ ok: true, value: [] });
    const rows = Array.from({ length: 200 }, (_, min) => ({ min, max: min, text: "x" }));
    expect(oracleRows(rows).ok).toBe(true);
    expect(oracleRows([...rows, { min: 200, max: 200, text: "x" }]).ok).toBe(false);
  });

  it("looks up inclusive bounds even in unsorted rows, leaving gaps unmatched", () => {
    for (const total of [-2, -1, 0]) expect(oracleRow([last, first], total)).toBe(first);
    for (const total of [3, 4, 5]) expect(oracleRow([last, first], total)).toBe(last);
    for (const total of [-3, 1, 2, 6, NaN, Infinity, -Infinity])
      expect(oracleRow([last, first], total)).toBeUndefined();
    expect(oracleRow([last, first], 3.5)).toBe(last);
    expect(oracleRow([], 1)).toBeUndefined();
  });
});

describe("oracleDice", () => {
  const rows = (max: number, min = 1) => [
    { min, max: Math.floor((min + max) / 2), text: "low" },
    { min: Math.floor((min + max) / 2) + 1, max, text: "high" },
  ];
  it("rolls the die the rows span", () => {
    expect(oracleDice("1d100", rows(20))).toBe("1d20");
    expect(oracleDice("1d6", rows(100))).toBe("1d100");
    expect(oracleDice("1d100", rows(10))).toBe("1d10");
  });
  it("rolls several dice when the rows run from k to k × a die size", () => {
    expect(oracleDice("1d6", rows(12, 2))).toBe("2d6");
    expect(oracleDice("1d6", rows(18, 3))).toBe("3d6");
  });
  it("keeps the field's dice otherwise", () => {
    expect(oracleDice("1d100", rows(7))).toBe("1d100");
    expect(oracleDice("1d100", [])).toBe("1d100");
  });
});
