/*
 * Progress tracks (Ironsworn/Starforged): ten boxes, each filled by up to four
 * ticks, stored as a tick count 0–40. The score is the number of full boxes.
 * How many ticks a mark adds is the rank's business — the table's, not ours.
 */

export const PROGRESS_BOXES = 10;
export const TICKS_PER_BOX = 4;
export const PROGRESS_TICKS = PROGRESS_BOXES * TICKS_PER_BOX;

/** Ticks clamped to 0–40 and rounded down; anything that isn't a number is 0. */
export const clampTicks = (ticks: unknown): number =>
  typeof ticks === "number" && !Number.isNaN(ticks)
    ? Math.max(0, Math.min(PROGRESS_TICKS, Math.floor(ticks)))
    : 0;

/** Full boxes, 0–10. */
export const progressScore = (ticks: number): number =>
  Math.floor(clampTicks(ticks) / TICKS_PER_BOX);

/** Ticks in each of the ten boxes, e.g. 6 ticks → [4, 2, 0, …]. */
export const progressBoxes = (ticks: number): number[] => {
  const clamped = clampTicks(ticks);
  return Array.from({ length: PROGRESS_BOXES }, (_, index) =>
    Math.max(0, Math.min(TICKS_PER_BOX, clamped - index * TICKS_PER_BOX)),
  );
};
