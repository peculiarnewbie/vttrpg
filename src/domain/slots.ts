import type { ListRow } from "./sheet-layout";

/*
 * Inventory slots where some items take more than one (Cairn's bulky items).
 * Display only: the sheet shows what's used; it never refuses an item.
 */

/** How many slots a row takes: its `sizeKey` value if a positive integer (max 10), else 1. */
export const rowSize = (row: ListRow, sizeKey: string | undefined): number => {
  const size = sizeKey === undefined ? undefined : row[sizeKey];
  return typeof size === "number" && Number.isInteger(size) && size > 0 ? Math.min(10, size) : 1;
};

/**
 * Where each row sits: `start` is its first slot (0-based), `size` how many it
 * takes, in row order. `used` is the total; it may exceed the slot count.
 */
export const slotLayout = (
  rows: readonly ListRow[],
  sizeKey: string | undefined,
): {
  readonly placed: readonly { index: number; start: number; size: number }[];
  readonly used: number;
} => {
  let used = 0;
  const placed = rows.map((row, index) => {
    const size = rowSize(row, sizeKey);
    const start = used;
    used += size;
    return { index, start, size };
  });
  return { placed, used };
};
