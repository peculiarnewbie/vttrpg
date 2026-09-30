import { expect, it } from "vitest";
import {
  clampTicks,
  progressBoxes,
  progressScore,
  PROGRESS_BOXES,
  PROGRESS_TICKS,
  TICKS_PER_BOX,
} from "./progress";

it.each<[unknown, number]>([
  [undefined, 0],
  [null, 0],
  [true, 0],
  ["6", 0],
  [[], 0],
  [{}, 0],
  [NaN, 0],
  [-Infinity, 0],
  [Infinity, 40],
  [-1, 0],
  [-0.1, 0],
  [0, 0],
  [6.9, 6],
  [39.9, 39],
  [40, 40],
  [1000000, 40],
])("clamps and floors ticks %j to %j", (input, ticks) => {
  expect(clampTicks(input)).toBe(ticks);
});

it("splits every tick count into ten boxes and counts only full boxes", () => {
  expect(PROGRESS_BOXES).toBe(10);
  expect(TICKS_PER_BOX).toBe(4);
  expect(PROGRESS_TICKS).toBe(40);
  for (let ticks = 0; ticks <= 40; ticks++) {
    const boxes = progressBoxes(ticks);
    expect(boxes).toHaveLength(10);
    expect(boxes.reduce((sum, value) => sum + value, 0)).toBe(ticks);
    expect(boxes.every((value) => Number.isInteger(value) && value >= 0 && value <= 4)).toBe(true);
    expect(boxes.filter((value) => value === 4)).toHaveLength(progressScore(ticks));
  }
  expect(progressBoxes(6)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(progressBoxes(6.9)).toEqual(progressBoxes(6));
  expect(progressScore(6.9)).toBe(1);
  expect(progressBoxes(Infinity)).toEqual(Array(10).fill(4));
  expect(progressBoxes(NaN)).toEqual(Array(10).fill(0));
  expect(progressScore(-1)).toBe(0);
  expect(progressScore(100)).toBe(10);
});
