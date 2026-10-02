import type { RollGroup, RollModifierPart, RollResult, RolledDie } from "./schemas";
import type { Rng } from "./dice";
import { evaluate, exprRefs, parseExpr, toNumber, type Expr, type Scope } from "./derived";

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
 *   term     := dice | integer | ref | formula
 *   dice     := [count] "d" sides suffix*
 *   count    := integer | "(" ref ")" | formula  omitted = 1; e.g. (@hunt)d6, {@level / 2}d6
 *   formula  := "{" expr "}"                      a formula (derived.ts), e.g. {@prof * 2}
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
 * `1d20 - 1d4`, `(@insight)d6khz`, `1d20+@row.bonus | 1d8+@str_mod`,
 * `1d20 + {@prof * 2}` (a one-off sum without its own derived value).
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

/** A `{…}` formula in notation: its text (shown in chat) and parsed form. */
export type NotationFormula = { readonly source: string; readonly expr: Expr };

export type DiceCount =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "ref"; readonly ref: Ref }
  | { readonly kind: "formula"; readonly formula: NotationFormula };

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
  | { readonly kind: "ref"; readonly sign: Sign; readonly ref: Ref }
  | { readonly kind: "formula"; readonly sign: Sign; readonly formula: NotationFormula };

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

type Symbol = "+" | "-" | "|" | "(" | ")" | "d" | "%" | "kh" | "kl" | "adv" | "dis" | "z" | "end";
type Token =
  | { readonly kind: "number"; readonly value: number; readonly position: number }
  | { readonly kind: "ref"; readonly ref: Ref; readonly position: number }
  | { readonly kind: "formula"; readonly formula: NotationFormula; readonly position: number }
  | { readonly kind: Symbol; readonly position: number };

class NotationError extends Error {}

function fail(message: string, position: number): never {
  throw new NotationError(`${message} at ${position}`);
}

const isDigit = (char: string) => char >= "0" && char <= "9";
const isNameStart = (char: string) => /^[A-Za-z_]$/.test(char);
const isNamePart = (char: string) => isNameStart(char) || isDigit(char);

/** Ref names are scanned separately so dice keywords never change their case or split them. */
const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let position = 0;
  const whitespace = () => {
    while (position < input.length && /\s/.test(input[position])) position++;
  };
  const name = (): string => {
    whitespace();
    const start = position;
    if (!isNameStart(input[position] ?? "")) fail("Expected a value name", position);
    while (position < input.length && isNamePart(input[position])) position++;
    return input.slice(start, position);
  };

  while (position < input.length) {
    whitespace();
    if (position === input.length) break;
    const start = position;
    const char = input[position];
    if (isDigit(char)) {
      while (position < input.length && isDigit(input[position])) position++;
      const value = Number(input.slice(start, position));
      if (value > DICE_LIMITS.number) fail(`Numbers must be at most ${DICE_LIMITS.number}`, start);
      tokens.push({ kind: "number", value, position: start });
    } else if (char === "{") {
      // A formula runs to its matching "}" (refs inside may use @{…}).
      let depth = 0;
      let end = position;
      for (; end < input.length; end++) {
        if (input[end] === "{") depth++;
        else if (input[end] === "}" && --depth === 0) break;
      }
      if (end === input.length) fail("Expected “}”", input.length);
      const source = input.slice(position + 1, end).trim();
      const parsed = parseExpr(source);
      if (!parsed.ok) {
        // Point at the problem inside the braces.
        const at = / at (\d+)$/.exec(parsed.error);
        fail(
          at ? parsed.error.slice(0, at.index) : parsed.error,
          at ? position + 1 + Number(at[1]) : start,
        );
      }
      tokens.push({ kind: "formula", formula: { source, expr: parsed.value }, position: start });
      position = end + 1;
    } else if (char === "@") {
      position++;
      whitespace();
      let ref: Ref;
      if (input[position] === "{") {
        position++;
        const keyStart = position;
        while (position < input.length && input[position] !== "}") {
          if (input[position] === "{") fail("Unexpected “{”", position);
          position++;
        }
        if (position === input.length) fail("Expected “}”", position);
        const keys = input
          .slice(keyStart, position)
          .split(".")
          .map((key) => key.trim());
        if (keys.length > 2 || keys.some((key) => !key)) fail("Expected a value name", keyStart);
        ref = keys.length === 2 ? { key: keys[0], column: keys[1] } : { key: keys[0] };
        position++;
      } else {
        const key = name();
        whitespace();
        if (input[position] === ".") {
          position++;
          ref = { key, column: name() };
        } else {
          ref = { key };
        }
      }
      tokens.push({ kind: "ref", ref, position: start });
    } else if (
      char === "+" ||
      char === "-" ||
      char === "|" ||
      char === "(" ||
      char === ")" ||
      char === "%"
    ) {
      tokens.push({ kind: char, position: start });
      position++;
    } else {
      const rest = input.slice(position).toLowerCase();
      const keyword = (["adv", "dis", "kh", "kl", "d", "z"] as const).find((word) =>
        rest.startsWith(word),
      );
      if (!keyword) fail(`Unexpected “${char}”`, position);
      tokens.push({ kind: keyword, position: start });
      position += keyword.length;
    }
  }
  tokens.push({ kind: "end", position: input.length });
  return tokens;
};

class NotationParser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.position];
  }

  private take(kind: Token["kind"]): boolean {
    if (this.peek().kind !== kind) return false;
    this.position++;
    return true;
  }

  private expect(kind: Token["kind"]): Token {
    const token = this.peek();
    if (!this.take(kind)) fail(`Expected “${kind}”`, token.position);
    return token;
  }

  parse(): Notation {
    const groups = [this.group()];
    while (this.take("|")) {
      if (groups.length === DICE_LIMITS.groups) fail("At most 4 groups", this.peek().position);
      groups.push(this.group());
    }
    const token = this.peek();
    if (token.kind !== "end") fail("Expected “+”, “-” or “|”", token.position);
    return { groups };
  }

  private group(): NotationGroup {
    let sign: Sign = this.take("-") ? -1 : 1;
    if (sign === 1) this.take("+");
    const terms = [this.term(sign)];
    while (this.peek().kind === "+" || this.peek().kind === "-") {
      sign = this.take("-") ? -1 : 1;
      if (sign === 1) this.take("+");
      if (terms.length === DICE_LIMITS.termsPerGroup)
        fail("At most 20 terms per group", this.peek().position);
      terms.push(this.term(sign));
    }
    return { terms };
  }

  private term(sign: Sign): Term {
    const token = this.peek();
    if (this.take("ref") && token.kind === "ref") return { kind: "ref", sign, ref: token.ref };
    let count: DiceCount = { kind: "fixed", value: 1 };
    if (this.take("formula") && token.kind === "formula") {
      if (this.peek().kind !== "d") return { kind: "formula", sign, formula: token.formula };
      count = { kind: "formula", formula: token.formula };
    } else if (this.take("number") && token.kind === "number") {
      if (this.peek().kind !== "d") return { kind: "number", sign, value: token.value };
      if (token.value > DICE_LIMITS.dice) fail("At most 100 dice per roll", token.position);
      count = { kind: "fixed", value: token.value };
    } else if (this.take("(")) {
      const ref = this.expect("ref");
      if (ref.kind === "ref") count = { kind: "ref", ref: ref.ref };
      this.expect(")");
    }
    this.expect("d");
    const sidesToken = this.peek();
    let sides: number;
    if (this.take("%")) {
      sides = 100;
    } else {
      const number = this.expect("number");
      sides = number.kind === "number" ? number.value : 0;
    }
    if (sides < 1) fail("Dice need at least 1 side", sidesToken.position);
    if (sides > DICE_LIMITS.sides) fail("Dice may have at most 1000 sides", sidesToken.position);
    let keep: DiceTerm["keep"];
    let advantage: DiceTerm["advantage"];
    let zero: DiceTerm["zero"];
    while (true) {
      const suffix = this.peek();
      if (suffix.kind === "z") {
        this.position++;
        if (zero) fail("Only one z suffix per dice term", suffix.position);
        zero = true;
      } else if (
        suffix.kind === "kh" ||
        suffix.kind === "kl" ||
        suffix.kind === "adv" ||
        suffix.kind === "dis"
      ) {
        this.position++;
        if (keep || advantage)
          fail("Only one of kh, kl, adv or dis per dice term", suffix.position);
        if (suffix.kind === "adv" || suffix.kind === "dis") {
          advantage = suffix.kind;
        } else {
          const number = this.peek();
          const keptCount = this.take("number") && number.kind === "number" ? number.value : 1;
          keep = { mode: suffix.kind === "kh" ? "highest" : "lowest", count: keptCount };
        }
      } else {
        break;
      }
    }
    return {
      kind: "dice",
      sign,
      count,
      sides,
      ...(keep ? { keep } : {}),
      ...(advantage ? { advantage } : {}),
      ...(zero ? { zero } : {}),
    };
  }
}

/**
 * Parse notation. Errors are short sentences a player can act on:
 * "Unexpected “x” at 5", "Dice need at least 1 side", "At most 4 groups".
 * Unknown tokens are errors, never ignored.
 */
export const parseNotation = (input: string): Parsed<Notation> => {
  if (input.length > DICE_LIMITS.length) return { ok: false, error: "At most 200 characters" };
  try {
    return { ok: true, value: new NotationParser(tokenize(input)).parse() };
  } catch (error) {
    if (error instanceof NotationError) return { ok: false, error: error.message };
    throw error;
  }
};

/** Every ref in the notation, including computed counts and formulas, in order of appearance. */
export const notationRefs = (notation: Notation): Ref[] =>
  notation.groups.flatMap((group) =>
    group.terms.flatMap((term) => {
      if (term.kind === "ref") return [term.ref];
      if (term.kind === "formula") return exprRefs(term.formula.expr);
      if (term.kind === "dice" && term.count.kind === "ref") return [term.count.ref];
      if (term.kind === "dice" && term.count.kind === "formula")
        return exprRefs(term.count.formula.expr);
      return [];
    }),
  );

/** The formulas in the notation (for checking which lists they read). */
export const notationFormulas = (notation: Notation): Expr[] =>
  notation.groups.flatMap((group) =>
    group.terms.flatMap((term) =>
      term.kind === "formula"
        ? [term.formula.expr]
        : term.kind === "dice" && term.count.kind === "formula"
          ? [term.count.formula.expr]
          : [],
    ),
  );

const formatRef = (ref: Ref): string => {
  const keys = ref.column === undefined ? [ref.key] : [ref.key, ref.column];
  const key = keys.join(".");
  return keys.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) ? `@${key}` : `@{${key}}`;
};

const formatTerm = (term: Term, compact = false): string => {
  if (term.kind === "number") return String(term.value);
  if (term.kind === "ref") return formatRef(term.ref);
  if (term.kind === "formula") return `{${term.formula.source}}`;
  const count =
    term.count.kind === "ref"
      ? `(${formatRef(term.count.ref)})`
      : term.count.kind === "formula"
        ? `{${term.count.formula.source}}`
        : compact && term.count.value === 1
          ? ""
          : String(term.count.value);
  const keep = term.keep
    ? `${term.keep.mode === "highest" ? "kh" : "kl"}${compact && term.keep.count === 1 ? "" : term.keep.count}`
    : "";
  const sides = compact && term.sides === 100 ? "%" : term.sides;
  return `${count}d${sides}${keep}${term.advantage ?? ""}${term.zero ? "z" : ""}`;
};

/** Canonical text: `1d20 + @str_mod | 2d6kh1`. Parsing the output gives the same notation. */
export const formatNotation = (notation: Notation): string => {
  const render = (compact: boolean) =>
    notation.groups
      .map((group) =>
        group.terms
          .map((term, index) => {
            const text = formatTerm(term, compact);
            if (index === 0) return term.sign === -1 ? `-${text}` : text;
            const operator = term.sign === -1 ? "-" : "+";
            return compact ? `${operator}${text}` : ` ${operator} ${text}`;
          })
          .join(""),
      )
      .join(compact ? "|" : " | ");
  const spaced = render(false);
  // Adding spaces and explicit defaults must not make valid input too long to parse again.
  return spaced.length <= DICE_LIMITS.length ? spaced : render(true);
};

const resolveRef = (ref: Ref, lookup?: RefLookup): Parsed<RefValue> => {
  const resolved = lookup?.(ref);
  if (!resolved) return { ok: false, error: `Unknown value ${formatRef(ref)}` };
  if (!Number.isFinite(resolved.value))
    return { ok: false, error: `Invalid value ${formatRef(ref)}` };
  return { ok: true, value: resolved };
};

type DicePlan = {
  readonly term: DiceTerm;
  readonly count: number;
  readonly keep?: DiceTerm["keep"];
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
  notation: Notation,
  options: {
    readonly lookup?: RefLookup;
    /** What `{…}` formulas read (lists and checks too); refs alone read `lookup` when it's absent. */
    readonly scope?: Scope;
    readonly rng?: Rng;
  } = {},
): Parsed<RollResult> => {
  // A formula's refs must all be known, as a plain ref's must; then it's evaluated.
  const formula = (value: NotationFormula): Parsed<number> => {
    for (const ref of exprRefs(value.expr)) {
      const resolved = resolveRef(ref, options.lookup);
      if (!resolved.ok) return resolved;
    }
    const scope: Scope = options.scope ?? { value: (ref) => options.lookup?.(ref)?.value };
    const result = toNumber(evaluate(value.expr, scope));
    if (Math.abs(result) > DICE_LIMITS.number)
      return { ok: false, error: `{${value.source}} must be between -1000000 and 1000000` };
    return { ok: true, value: Math.floor(result) };
  };
  const plans: { dice: DicePlan[]; modifiers: RollModifierPart[] }[] = [];
  let diceCount = 0;
  // Resolve and check the whole roll before consuming randomness.
  for (const group of notation.groups) {
    const dice: DicePlan[] = [];
    const modifiers: RollModifierPart[] = [];
    let staticBonus = 0;
    for (const term of group.terms) {
      if (term.kind === "number") {
        staticBonus += term.sign * term.value;
        continue;
      }
      if (term.kind === "formula") {
        const resolved = formula(term.formula);
        if (!resolved.ok) return resolved;
        modifiers.push({ label: term.formula.source, value: term.sign * resolved.value });
        continue;
      }
      if (term.kind === "ref") {
        const resolved = resolveRef(term.ref, options.lookup);
        if (!resolved.ok) return resolved;
        if (Math.abs(resolved.value.value) > DICE_LIMITS.number) {
          return {
            ok: false,
            error: `Value ${formatRef(term.ref)} must be between -1000000 and 1000000`,
          };
        }
        modifiers.push({
          label: resolved.value.label,
          value: term.sign * Math.floor(resolved.value.value),
        });
        continue;
      }
      let count: number;
      if (term.count.kind === "fixed") {
        count = term.count.value;
      } else if (term.count.kind === "formula") {
        const resolved = formula(term.count.formula);
        if (!resolved.ok) return resolved;
        count = Math.max(0, resolved.value);
      } else {
        const resolved = resolveRef(term.count.ref, options.lookup);
        if (!resolved.ok) return resolved;
        count = Math.max(0, Math.floor(resolved.value.value));
      }
      let rolledCount = count;
      let keep = term.keep;
      if (count <= 0 && term.zero) {
        rolledCount = 2;
        keep = { mode: "lowest", count: 1 };
      } else if (term.advantage) {
        rolledCount++;
        keep = { mode: term.advantage === "adv" ? "highest" : "lowest", count };
      }
      diceCount += rolledCount;
      if (diceCount > DICE_LIMITS.dice) return { ok: false, error: "At most 100 dice per roll" };
      dice.push({ term, count: rolledCount, keep });
    }
    if (staticBonus !== 0) modifiers.unshift({ label: "static", value: staticBonus });
    plans.push({ dice, modifiers });
  }
  const rng = options.rng ?? Math.random;
  const groups: RollGroup[] = plans.map((plan, groupIndex) => {
    const dice: RolledDie[] = plan.dice.map(({ term, count, keep }) => {
      const results = Array.from({ length: count }, () => Math.floor(rng() * term.sides) + 1);
      let kept: boolean[] | undefined;
      if (keep && keep.count < count) {
        const order = results
          .map((value, index) => ({ value, index }))
          .sort(
            (a, b) =>
              (keep.mode === "highest" ? b.value - a.value : a.value - b.value) ||
              a.index - b.index,
          );
        const indices = new Set(order.slice(0, keep.count).map(({ index }) => index));
        kept = results.map((_, index) => indices.has(index));
      }
      return {
        sides: term.sides,
        results,
        ...(kept ? { kept } : {}),
        ...(term.sign === -1 ? { negative: true } : {}),
      };
    });
    const total =
      dice.reduce(
        (sum, die) =>
          sum +
          (die.negative ? -1 : 1) *
            die.results.reduce(
              (subtotal, value, index) => subtotal + (die.kept?.[index] === false ? 0 : value),
              0,
            ),
        0,
      ) + plan.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
    return {
      notation: formatNotation({ groups: [notation.groups[groupIndex]] }),
      dice,
      modifiers: plan.modifiers,
      total,
    };
  });
  return {
    ok: true,
    value: {
      ...groups[0],
      notation: formatNotation(notation),
      ...(groups.length > 1 ? { groups } : {}),
    },
  };
};

/** {@link parseNotation} then {@link rollNotation}. */
export const rollText = (
  input: string,
  options: Parameters<typeof rollNotation>[1] = {},
): Parsed<RollResult> => {
  const parsed = parseNotation(input);
  return parsed.ok ? rollNotation(parsed.value, options) : parsed;
};
