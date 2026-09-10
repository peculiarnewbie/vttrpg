import type {
  CharacterValue,
  DiceGroup,
  Modifier,
  RollDefinition,
  RollModifierPart,
  RollResult,
  RolledDie,
  StatDefinition,
} from "./schemas";

export type Rng = () => number;

const defaultRng: Rng = () => Math.random();

const rollDie = (sides: number, rng: Rng) => Math.floor(rng() * sides) + 1;

export const formatDice = (dice: readonly DiceGroup[]) =>
  dice.map((group) => `${group.count}d${group.sides}`).join(" + ");

export const diceExpression = (
  dice: readonly DiceGroup[],
  modifiers: readonly RollModifierPart[],
) => {
  const base = formatDice(dice) || "0";
  const mods = modifiers
    .filter((part) => part.value !== 0)
    .map((part) => `${part.value >= 0 ? "+" : "-"} ${Math.abs(part.value)}`)
    .join(" ");
  return mods ? `${base} ${mods}` : base;
};

/**
 * A resolver gives the dice engine access to sheet values. Stats are computed
 * separately via {@link computeStats} so stat-to-stat references can resolve
 * without building a cyclic proxy.
 */
export type ModifierResolver = {
  valueOfField: (fieldId: string) => number;
  valueOfStat: (statId: string) => number;
};

export const makeResolver = (
  values: Readonly<Record<string, CharacterValue>>,
  stats: Record<string, number>,
): ModifierResolver => ({
  valueOfField: (fieldId) => {
    const n = Number(values[fieldId] ?? 0);
    return Number.isFinite(n) ? n : 0;
  },
  valueOfStat: (statId) => stats[statId] ?? 0,
});

export const resolveModifier = (
  modifier: Modifier,
  resolver: ModifierResolver,
): RollModifierPart => {
  switch (modifier.kind) {
    case "static":
      return {
        label: `static ${modifier.value >= 0 ? "+" : ""}${modifier.value}`,
        value: modifier.value,
      };
    case "stat": {
      const multiplier = modifier.multiplier ?? 1;
      const value = resolver.valueOfStat(modifier.statId) * multiplier;
      return {
        label: `${modifier.statId}${multiplier !== 1 ? ` x${multiplier}` : ""}`,
        value,
      };
    }
    case "field": {
      const multiplier = modifier.multiplier ?? 1;
      const value = resolver.valueOfField(modifier.fieldId) * multiplier;
      return {
        label: `${modifier.fieldId}${multiplier !== 1 ? ` x${multiplier}` : ""}`,
        value,
      };
    }
  }
};

export const resolveModifiers = (
  modifiers: readonly Modifier[],
  resolver: ModifierResolver,
): RollModifierPart[] => modifiers.map((modifier) => resolveModifier(modifier, resolver));

/**
 * Resolve every stat's numeric value. Stats may reference other stats; cycles
 * resolve to `0` rather than throwing.
 */
export const computeStats = (
  stats: readonly StatDefinition[],
  values: Readonly<Record<string, CharacterValue>>,
): Record<string, number> => {
  const byId = new Map(stats.map((stat) => [stat.id, stat]));
  const cache: Record<string, number> = {};
  const inProgress = new Set<string>();

  const resolveStat = (id: string): number => {
    const cached = cache[id];
    if (cached !== undefined) return cached;
    const stat = byId.get(id);
    if (!stat || inProgress.has(id)) return 0;
    inProgress.add(id);
    const resolver = makeResolver(
      values,
      new Proxy(cache, { get: (_, key) => resolveStat(String(key)) }),
    );
    let total = stat.base ?? 0;
    for (const modifier of stat.modifiers) total += resolveModifier(modifier, resolver).value;
    inProgress.delete(id);
    cache[id] = total;
    return total;
  };

  for (const stat of stats) resolveStat(stat.id);
  return cache;
};

export const rollDice = (dice: readonly DiceGroup[], rng: Rng = defaultRng): RolledDie[] =>
  dice.map((group) => ({
    sides: group.sides,
    results: Array.from({ length: Math.max(0, group.count) }, () => rollDie(group.sides, rng)),
  }));

export const sumDice = (dice: readonly RolledDie[]) =>
  dice.reduce((total, die) => total + die.results.reduce((a, b) => a + b, 0), 0);

export const evaluateRoll = (
  definition: RollDefinition,
  resolver: ModifierResolver,
  rng: Rng = defaultRng,
): RollResult => {
  const dice = rollDice(definition.dice, rng);
  const modifiers = resolveModifiers(definition.modifiers, resolver);
  const total = sumDice(dice) + modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
  return {
    notation: `${formatDice(definition.dice) || "0"}${modifiers.length ? " + mods" : ""}`,
    dice,
    modifiers,
    total,
  };
};

/**
 * Parse a free-form dice expression such as `2d6`, `1d20+5`, or `2d6 + 1d8 - 1`.
 */
export const parseDiceExpression = (input: string): { dice: DiceGroup[]; staticBonus: number } => {
  const normalized = input.replace(/\s+/g, "").toLowerCase();
  if (!normalized) return { dice: [], staticBonus: 0 };
  const tokens = normalized.match(/[+-]?[^+-]+/g) ?? [];
  const dice: DiceGroup[] = [];
  let staticBonus = 0;

  for (const rawToken of tokens) {
    const sign = rawToken.startsWith("-") ? -1 : 1;
    const token = rawToken.replace(/^[+-]/, "");
    const match = /^(\d*)d(\d+)$/.exec(token);
    if (match) {
      const count = match[1] === "" ? 1 : Number(match[1]);
      const sides = Number(match[2]);
      if (count > 0 && sides > 0) dice.push({ count, sides });
      continue;
    }
    const flat = Number(token);
    if (Number.isFinite(flat)) staticBonus += sign * flat;
  }

  return { dice, staticBonus };
};

export const rollExpression = (input: string, rng: Rng = defaultRng): RollResult => {
  const { dice, staticBonus } = parseDiceExpression(input);
  const rolled = rollDice(dice, rng);
  const modifiers: RollModifierPart[] =
    staticBonus !== 0 ? [{ label: "static", value: staticBonus }] : [];
  const total = sumDice(rolled) + staticBonus;
  return {
    notation: diceExpression(dice, modifiers),
    dice: rolled,
    modifiers,
    total,
  };
};
