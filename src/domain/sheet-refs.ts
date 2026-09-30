import type { RefLookup } from "./dice-notation";
import type { DerivedResult, ExprScope } from "./derived";
import type { ListRow, SheetLayout, SheetValues } from "./sheet-layout";

/*
 * How `@refs` in derived values and roll notation read a character's values.
 * Used by the sheet (display) and by the server (rolls), so both agree.
 *
 * - `@key` — a derived value if the layout defines one with that key;
 *   otherwise the character value: a number; a numeric string ("3"); true = 1,
 *   false = 0; a string array (checks) = how many are checked; a list = its
 *   row count. Anything else (empty, text) is `undefined`, i.e. 0.
 * - `@list.column` — the sum of that numeric column over the list's rows.
 * - `@row.column` — the column in the current row (a list row's roll or a
 *   derived list column); `undefined` without a current row.
 */

/** Resolve refs to non-derived values. */
export const valueScope = (_values: SheetValues, _row?: ListRow): ExprScope => {
  throw new Error("not implemented");
};

/** {@link computeDerived} for a layout's `derived` list against these values. */
export const sheetDerived = (
  _layout: SheetLayout | undefined,
  _values: SheetValues,
): DerivedResult => {
  throw new Error("not implemented");
};

/** Derived values first, then {@link valueScope}. */
export const sheetScope = (
  _layout: SheetLayout | undefined,
  _values: SheetValues,
  _row?: ListRow,
): ExprScope => {
  throw new Error("not implemented");
};

/**
 * Lookup for {@link rollNotation}. Labels come from the layout: a derived
 * value's label, else the label of a stat/field/tracker item with that key,
 * else a list column's label for `@row.column`, else the key itself. Refs that
 * resolve to `undefined` still resolve (to 0) when the key is known to the
 * layout or present in `values`; otherwise the lookup returns `undefined` so
 * a typo fails the roll instead of silently adding 0.
 */
export const sheetRefLookup = (
  _layout: SheetLayout | undefined,
  _values: SheetValues,
  _row?: ListRow,
): RefLookup => {
  throw new Error("not implemented");
};

/**
 * Problems an author should see while editing, which don't block saving
 * (so older layouts stay saveable): derived cycles, roll notations that
 * don't parse, refs to keys the layout doesn't know. One sentence each,
 * naming the block or derived value.
 */
export const layoutProblems = (_layout: SheetLayout): string[] => {
  throw new Error("not implemented");
};
