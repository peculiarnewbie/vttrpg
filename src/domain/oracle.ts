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
export const oracleRows = (value: unknown): Parsed<readonly OracleRow[]> => {
  if (!Array.isArray(value) || value.length > 200)
    return { ok: false, error: "Oracle must have at most 200 rows" };
  const rows: OracleRow[] = [];
  for (const row of value) {
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      !Number.isInteger(row.min) ||
      !Number.isInteger(row.max) ||
      row.min > row.max ||
      typeof row.text !== "string" ||
      !row.text.trim()
    )
      return { ok: false, error: "Oracle rows need integer min ≤ max and text" };
    rows.push({ min: row.min, max: row.max, text: row.text });
  }
  rows.sort((a, b) => a.min - b.min);
  for (let index = 1; index < rows.length; index++) {
    if (rows[index].min <= rows[index - 1].max)
      return { ok: false, error: "Oracle rows must not overlap" };
  }
  return { ok: true, value: rows };
};

/** The row covering `total`, if any. */
export const oracleRow = (rows: readonly OracleRow[], total: number): OracleRow | undefined =>
  Number.isFinite(total) ? rows.find((row) => row.min <= total && total <= row.max) : undefined;

/** Rows as they're stored in an entry's fields (ListRow[]). */
export const oracleListRows = (rows: readonly OracleRow[]): ListRow[] =>
  rows.map((row) => ({ min: row.min, max: row.max, text: row.text }));

const DIE_SIZES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

/**
 * The dice a table rolls, derived from its rows: rows from 1 to a die size
 * roll that die (1–20 → 1d20), and rows from k to k × a die size roll k of them
 * (2–12 → 2d6, 3–18 → 3d6), so one oracle type serves tables of every size.
 * Anything else keeps the field's own notation.
 */
export const oracleDice = (fieldDice: string | undefined, rows: readonly OracleRow[]) => {
  const first = rows[0]?.min;
  const last = rows.at(-1)?.max;
  if (first === undefined || last === undefined || first < 1 || first > 4) return fieldDice;
  const sides = last / first;
  return Number.isInteger(sides) && DIE_SIZES.has(sides) ? `${first}d${sides}` : fieldDice;
};
