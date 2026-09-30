import type { CompendiumEntry } from "./compendium";
import type { ListColumn, ListRow } from "./sheet-layout";

/*
 * Copied list rows remember their entry (`_entry`) and its revision (`_rev`).
 * When the entry has changed since, the sheet offers the update — showing
 * what would change — and applies it only when the owner says so. Players may
 * have edited their copy on purpose; nothing changes silently.
 */

export type RowChange = {
  readonly key: string;
  readonly label: string;
  readonly from: ListRow[string] | undefined;
  readonly to: ListRow[string] | undefined;
};

export type RowUpdate = {
  /** The entry's current revision; applying the update stores it in `_rev`. */
  readonly rev: number;
  /** Columns whose copied value differs from the entry's now (name included). */
  readonly changes: readonly RowChange[];
};

/**
 * The update on offer for a copied row, or `undefined` when there is none:
 * the row isn't from this entry, has no `_rev`, or `entry.rev` isn't newer.
 * A newer entry whose copied columns all still match gives `changes: []`
 * (applying it just records the revision). Derived columns never count.
 */
export const rowUpdate = (
  _row: ListRow,
  _entry: CompendiumEntry,
  _columns: readonly ListColumn[],
): RowUpdate | undefined => {
  throw new Error("not implemented");
};

/**
 * The row with the entry's current values in the copied columns and the new
 * `_rev`. Columns the entry doesn't fill keep the row's value; `_entry` and
 * other extra keys are kept.
 */
export const applyRowUpdate = (
  _row: ListRow,
  _entry: CompendiumEntry,
  _columns: readonly ListColumn[],
): ListRow => {
  throw new Error("not implemented");
};
