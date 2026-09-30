import type { ListRow } from "./sheet-layout";

/*
 * Progression tables: rows keyed by `level` (a class's features and
 * proficiency by level). Sheets show the rows up to the character's level and
 * can offer to copy what a level adds; nothing is applied or validated.
 */

// Display helpers also read numeric strings; persisted progression levels are validated separately.
const rowLevel = (row: ListRow): number | undefined => {
  const value = typeof row.level === "string" && row.level.trim() ? Number(row.level) : row.level;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/** Rows with a numeric `level` ≤ `level`, in level order (stable within a level). */
export const rowsUpToLevel = (rows: readonly ListRow[], level: number): ListRow[] =>
  rows
    .filter((row) => {
      const value = rowLevel(row);
      return value !== undefined && value <= level;
    })
    .sort((a, b) => Number(a.level) - Number(b.level));

/** Rows whose level is in (`from`, `to`] — what going from one level to another adds. */
export const rowsGained = (rows: readonly ListRow[], from: number, to: number): ListRow[] =>
  rowsUpToLevel(rows, to).filter((row) => Number(row.level) > from);
