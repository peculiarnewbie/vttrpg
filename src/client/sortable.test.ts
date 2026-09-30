import { describe, expect, it } from "vitest";
import { dropIndex, moveIndex } from "./sortable";

describe("sortable", () => {
  it("moves an item to an index in the list without it", () => {
    expect(moveIndex(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveIndex(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveIndex(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveIndex(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveIndex(["a"], 5, 0)).toEqual(["a"]);
  });

  it("counts the other items above the pointer", () => {
    const spans = [0, 1, 2, 3].map((i) => ({ top: i * 20, bottom: i * 20 + 20 }));
    // Dragging the first item past the third item's middle (50) lands it after it.
    expect(dropIndex(spans, 0, 55)).toBe(2);
    expect(dropIndex(spans, 0, 5)).toBe(0);
    expect(dropIndex(spans, 3, 5)).toBe(0);
    expect(dropIndex(spans, 1, 200)).toBe(3);
    expect(moveIndex(["a", "b", "c", "d"], 0, dropIndex(spans, 0, 55))).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });
});
