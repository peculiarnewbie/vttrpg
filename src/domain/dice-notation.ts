import type { RollResult } from "./schemas";
import type { Rng } from "./dice";

/*
 * Dice notation: what a player types in chat and what a sheet author writes
 * in a roll. The app only makes the roll — it never compares the total to
 * anything (docs/v1-scope.md).
 *
 * Grammar (whitespace is ignored; `d`, `kh`, `kl`, `adv`, `dis`, `z` are
 * case-insensitive; ref names are case-sensitive):
 *
 *   notation := group ("|" group)*               at most 4 groups
 *   group    := ["+"|"-"] term (("+"|"-") term)* at most 20 terms
 *   term     := dice | integer | ref
 *   dice     := [count] "d" sides suffix*
 *   count    := integer | "(" ref ")"            omitted = 1; e.g. (@hunt)d6
 *   sides    := integer | "%"                    % = 100
 *   suffix   := "kh" [integer]                   keep highest (default 1)
 *             | "kl" [integer]                   keep lowest (default 1)
 *             | "adv" | "dis"                    roll one extra die, drop the lowest/highest
 *             | "z"                              zero dice: if count ≤ 0, roll 2 and keep the lowest (Blades)
 *   ref      := "@" name ["." name]              @str_mod, @row.bonus, @inventory.weight
 *             | "@{" key ["." key] "}"            for keys with other characters, e.g. @{hp-max}
 *   name     := [A-Za-z_][A-Za-z0-9_]*
 *
 * Groups split by `|` are rolled independently and never summed together
 * ("1d20+5 | 2d6+3": attack and damage in one click).
 *
 * A dice term takes at most one of kh/kl/adv/dis. `z` combines with kh ("pool").
 * Examples: `2d6`, `1d20+@str_mod`, `1d20adv+@dex_mod`, `4d6kh3`, `d%`,
 * `1d20 - 1d4`, `(@insight)d6khz`, `1d20+@row.bonus | 1d8+@str_mod`.
 */

export const DICE_LIMITS = {
  /** Characters in one notation. */
  length: 200,
  groups: 4,
  termsPerGroup: 20,
  /** Dice actually rolled across every group, after refs and adv/dis/z resolve. */
  dice: 100,
  sides: 1000,
  /** Largest integer literal and largest absolute ref value used as a modifier. */
  number: 1_000_000,
} as const;

/** A reference to a sheet value: `@key`, or `@key.column` for list columns and the current row. */
export type Ref = { readonly key: string; readonly column?: string };

export type DiceCount =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "ref"; readonly ref: Ref };

export type Sign = 1 | -1;

export type DiceTerm = {
  readonly kind: "dice";
  readonly sign: Sign;
  readonly count: DiceCount;
  readonly sides: number;
  /** Keep the highest or lowest `count` dice. */
  readonly keep?: { readonly mode: "highest" | "lowest"; readonly count: number };
  /** Roll count + 1 and keep the highest (adv) or lowest (dis) `count`. */
  readonly advantage?: "adv" | "dis";
  /** If the resolved count is ≤ 0, roll 2 dice and keep the lowest instead of rolling nothing. */
  readonly zero?: boolean;
};

export type Term =
  | DiceTerm
  | { readonly kind: "number"; readonly sign: Sign; readonly value: number }
  | { readonly kind: "ref"; readonly sign: Sign; readonly ref: Ref };

export type NotationGroup = { readonly terms: readonly Term[] };
export type Notation = { readonly groups: readonly NotationGroup[] };

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * A value a ref resolves to. `label` is what chat shows for the modifier
 * ("STR mod", "Bonus"); refs that aren't found make the roll fail.
 */
export type RefValue = { readonly value: number; readonly label: string };
export type RefLookup = (ref: Ref) => RefValue | undefined;

/**
 * Parse notation. Errors are short sentences a player can act on:
 * "Unexpected “x” at 5", "Dice need at least 1 side", "At most 4 groups".
 * Unknown tokens are errors, never ignored.
 */
export const parseNotation = (_input: string): Parsed<Notation> => {
  throw new Error("not implemented");
};

/** Every ref in the notation, including computed counts, in order of appearance. */
export const notationRefs = (_notation: Notation): Ref[] => {
  throw new Error("not implemented");
};

/** Canonical text: `1d20 + @str_mod | 2d6kh1`. Parsing the output gives the same notation. */
export const formatNotation = (_notation: Notation): string => {
  throw new Error("not implemented");
};

/**
 * Roll parsed notation.
 *
 * - Refs resolve through `lookup`; a missing lookup or an unknown ref fails
 *   with "Unknown value @key". Ref values are floored to integers.
 * - Computed counts are floored and clamped at 0; more than
 *   {@link DICE_LIMITS.dice} dice in total fails the roll.
 * - Each dice term becomes one `RolledDie` with every die rolled; dropped dice
 *   are marked in `kept` and a subtracted term has `negative: true`.
 * - Number terms become a `static` modifier; ref terms become a modifier
 *   labelled by the lookup. Modifier values carry their sign.
 * - With one group the result is that group. With several, `groups` holds
 *   each group's result and the top-level fields repeat the first group's
 *   (older clients show that one).
 * - `notation` is {@link formatNotation} of the input.
 */
export const rollNotation = (
  _notation: Notation,
  _options: { readonly lookup?: RefLookup; readonly rng?: Rng } = {},
): Parsed<RollResult> => {
  throw new Error("not implemented");
};

/** {@link parseNotation} then {@link rollNotation}. */
export const rollText = (
  input: string,
  options: { readonly lookup?: RefLookup; readonly rng?: Rng } = {},
): Parsed<RollResult> => {
  const parsed = parseNotation(input);
  return parsed.ok ? rollNotation(parsed.value, options) : parsed;
};
