import { expect, it } from "vitest";
import type { ListRow } from "./sheet-layout";
import { rowsGained, rowsUpToLevel } from "./progression";

const rows: ListRow[] = [
  { level: 3, name: "Third" },
  { level: "2", name: "Second A" },
  { level: 1, name: "First" },
  { level: " 2 ", name: "Second B" },
  {},
  { level: "" },
  { level: " " },
  { level: "bad" },
  { level: true },
  { level: ["1"] },
  { level: NaN },
  { level: Infinity },
];

it("selects numeric levels and numeric strings in stable level order without mutating", () => {
  const original = [...rows];
  expect(rowsUpToLevel(rows, 2)).toEqual([rows[2], rows[1], rows[3]]);
  expect(rowsUpToLevel(rows, 3)).toEqual([rows[2], rows[1], rows[3], rows[0]]);
  expect(rowsUpToLevel(rows, 1)[0]).toBe(rows[2]);
  expect(rows).toEqual(original);
  expect(rowsUpToLevel(rows, NaN)).toEqual([]);
  expect(rowsUpToLevel(rows, 0)).toEqual([]);
  expect(rowsUpToLevel([], 30)).toEqual([]);
});

it("selects only levels in (from, to], including stable ties, and never applies rows", () => {
  expect(rowsGained(rows, 1, 2)).toEqual([rows[1], rows[3]]);
  expect(rowsGained(rows, 2, 3)).toEqual([rows[0]]);
  expect(rowsGained(rows, 3, 1)).toEqual([]);
  expect(rowsGained(rows, 2, 2)).toEqual([]);
  expect(rowsGained(rows, NaN, 3)).toEqual([]);
  expect(rowsGained(rows, 1, NaN)).toEqual([]);
});

it("uses numeric comparisons without enforcing stored level limits", () => {
  const numeric = [{ level: -1 }, { level: 1.5 }, { level: 31 }];
  expect(rowsUpToLevel(numeric, 2)).toEqual(numeric.slice(0, 2));
  expect(rowsGained(numeric, 1, 40)).toEqual(numeric.slice(1));
  expect(rowsUpToLevel(numeric, Infinity)).toEqual(numeric);
  expect(rowsUpToLevel(numeric, -Infinity)).toEqual([]);
});
