import type { ListRow } from "./sheet-layout";

/*
 * Inventory slots where some items take more than one (Cairn's bulky items).
 * Display only: the sheet shows what's used; it never refuses an item.
 */

/** How many slots a row takes: its `sizeKey` value if a positive integer (max 10), else 1. */
export const rowSize = (_row: ListRow, _sizeKey: string | undefined): number => {
  throw new Error("not implemented");
};

/**
 * Where each row sits: `start` is its first slot (0-based), `size` how many it
 * takes, in row order. `used` is the total; it may exceed the slot count.
 */
export const slotLayout = (
  _rows: readonly ListRow[],
  _sizeKey: string | undefined,
): {
  readonly placed: readonly { index: number; start: number; size: number }[];
  readonly used: number;
} => {
  throw new Error("not implemented");
};
