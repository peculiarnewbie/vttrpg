import { expect, it } from "vitest";
import type { ListRow } from "./sheet-layout";
import { rowSize, slotLayout } from "./slots";

it.each<[ListRow[string], number]>([
  [0, 1],
  [-1, 1],
  [1.5, 1],
  [NaN, 1],
  [Infinity, 1],
  [-Infinity, 1],
  ["2", 1],
  ["", 1],
  [true, 1],
  [["2"], 1],
  [1, 1],
  [2, 2],
  [10, 10],
  [11, 10],
  [1e100, 10],
])("uses positive integer sizes, capped at ten: %j", (size, expected) => {
  expect(rowSize({ size }, "size")).toBe(expected);
});

it("defaults missing sizes to one and uses the selected key", () => {
  expect(rowSize({}, "size")).toBe(1);
  expect(rowSize({ size: 3 }, undefined)).toBe(1);
  expect(rowSize({ size: 3, other: 2 }, "other")).toBe(2);
});

it("lays rows out in order and counts every slot without enforcing capacity", () => {
  const rows: ListRow[] = [{ size: 2 }, {}, { size: 3 }, { size: 100 }];
  expect(slotLayout(rows, "size")).toEqual({
    placed: [
      { index: 0, start: 0, size: 2 },
      { index: 1, start: 2, size: 1 },
      { index: 2, start: 3, size: 3 },
      { index: 3, start: 6, size: 10 },
    ],
    used: 16,
  });
  expect(rows).toEqual([{ size: 2 }, {}, { size: 3 }, { size: 100 }]);
  expect(slotLayout([], undefined)).toEqual({ placed: [], used: 0 });
  expect(slotLayout(rows, undefined).used).toBe(4);
});
