import type { Parsed } from "./dice-notation";
import type { ListRow } from "./sheet-layout";

/*
 * Oracle tables (Starforged's Action and Theme, a random encounter table):
 * an entry field with dice notation and rows `{min, max, text}`. Rolling
 * shows the row the total landed on. The row's text is content; the app never
 * reads meaning into it.
 */

export type OracleRow = { readonly min: number; readonly max: number; readonly text: string };

/**
 * The rows of an oracle field value, validated: every row has integer
 * `min ≤ max` and a non-empty `text`, rows don't overlap, and there are at
 * most 200. Gaps are allowed (a total in a gap lands on no row). Rows come
 * back sorted by `min`.
 */
export const oracleRows = (_value: unknown): Parsed<readonly OracleRow[]> => {
  throw new Error("not implemented");
};

/** The row covering `total`, if any. */
export const oracleRow = (_rows: readonly OracleRow[], _total: number): OracleRow | undefined => {
  throw new Error("not implemented");
};

/** Rows as they're stored in an entry's fields (ListRow[]). */
export const oracleListRows = (rows: readonly OracleRow[]): ListRow[] =>
  rows.map((row) => ({ min: row.min, max: row.max, text: row.text }));
