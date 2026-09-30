import type { ListRow } from "./sheet-layout";

/*
 * Progression tables: rows keyed by `level` (a class's features and
 * proficiency by level). Sheets show the rows up to the character's level and
 * can offer to copy what a level adds; nothing is applied or validated.
 */

/** Rows with a numeric `level` ≤ `level`, in level order (stable within a level). */
export const rowsUpToLevel = (_rows: readonly ListRow[], _level: number): ListRow[] => {
  throw new Error("not implemented");
};

/** Rows whose level is in (`from`, `to`] — what going from one level to another adds. */
export const rowsGained = (_rows: readonly ListRow[], _from: number, _to: number): ListRow[] => {
  throw new Error("not implemented");
};
