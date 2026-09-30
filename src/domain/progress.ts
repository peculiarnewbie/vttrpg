/*
 * Progress tracks (Ironsworn/Starforged): ten boxes, each filled by up to four
 * ticks, stored as a tick count 0–40. The score is the number of full boxes.
 * How many ticks a mark adds is the rank's business — the table's, not ours.
 */

export const PROGRESS_BOXES = 10;
export const TICKS_PER_BOX = 4;
export const PROGRESS_TICKS = PROGRESS_BOXES * TICKS_PER_BOX;

/** Ticks clamped to 0–40 and rounded down; anything that isn't a number is 0. */
export const clampTicks = (_ticks: unknown): number => {
  throw new Error("not implemented");
};

/** Full boxes, 0–10. */
export const progressScore = (_ticks: number): number => {
  throw new Error("not implemented");
};

/** Ticks in each of the ten boxes, e.g. 6 ticks → [4, 2, 0, …]. */
export const progressBoxes = (_ticks: number): number[] => {
  throw new Error("not implemented");
};
