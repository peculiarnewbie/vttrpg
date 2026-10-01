import { parseNotation } from "../../../src/domain/dice-notation";
import {
  activities,
  array,
  at,
  mod,
  num,
  object,
  proficiency,
  signed,
  strings,
  text,
  title,
  type Data,
} from "./data";

export type RollContext = { doc: Data; actor?: Data };
export type RollPart = { notation: string; label: string };
export const abilityFor = (context: RollContext, activity: Data): string => {
  const system = object(context.doc.system);
  const explicit = text(at(activity, "attack.ability"));
  if (explicit && explicit !== "spellcasting") return explicit;
  if (
    explicit === "spellcasting" ||
    context.doc.type !== "weapon" ||
    at(activity, "attack.type.classification") === "spell"
  )
    return text(at(context.actor, "system.attributes.spellcasting")) || "str";
  const kind = text(at(system, "type.value"));
  if (kind.endsWith("R") || at(activity, "attack.type.value") === "ranged") return "dex";
  if (
    strings(system.properties).includes("fin") &&
    mod(context.actor, "dex") > mod(context.actor, "str")
  )
    return "dex";
  return "str";
};

// Evaluate only arithmetic used by display formulas; never execute upstream code.
export const arithmetic = (input: string): number | undefined => {
  const compact = input.replace(/\s/g, "");
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
  if (!compact || tokens.join("") !== compact) return undefined;
  let i = 0;
  const atom = (): number => {
    if (tokens[i] === "+" || tokens[i] === "-") {
      const sign = tokens[i++] === "-" ? -1 : 1;
      return sign * atom();
    }
    if (tokens[i] === "(") {
      i++;
      const n = sum();
      if (tokens[i++] !== ")") return NaN;
      return n;
    }
    const token = tokens[i++];
    return token && /^\d/.test(token) ? Number(token) : NaN;
  };
  const product = (): number => {
    let n = atom();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const r = atom();
      n = op === "*" ? n * r : n / r;
    }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const r = product();
      n = op === "+" ? n + r : n - r;
    }
    return n;
  };
  const n = sum();
  return i === tokens.length && Number.isFinite(n) ? n : undefined;
};
export const substitute = (input: string, context: RollContext, activity: Data = {}): string =>
  input.replace(/@[\w.-]+/g, (ref) => {
    if (ref.startsWith("@flags.dnd5e.summon."))
      return (
        {
          level: "@spell_level",
          mod: "@spell_mod",
          attack: "@spell_attack",
          prof: "@proficiency",
          dc: "@spell_dc",
        }[ref.slice(20)] ?? ref
      );
    if (ref === "@mod")
      return context.actor
        ? String(mod(context.actor, abilityFor(context, activity)))
        : "@spell_mod";
    if (ref === "@prof")
      return context.actor && at(context.actor, "system.details.cr") != null
        ? String(proficiency(context.actor))
        : "@proficiency";
    if (ref === "@item.level") return text(at(context.doc, "system.level"));
    if (ref === "@attributes.spell.dc")
      return context.actor
        ? String(
            8 +
              proficiency(context.actor) +
              mod(
                context.actor,
                text(at(context.actor, "system.attributes.spellcasting")) || "str",
              ),
          )
        : "spell save DC";
    const value = ref.startsWith("@item.")
      ? at(context.doc.system, ref.slice(6))
      : at(context.actor?.system, ref.slice(1));
    return text(value) || ref;
  });
export const dc = (context: RollContext, activity: Data, kind = "save"): string => {
  const calculation = text(at(activity, `${kind}.dc.calculation`));
  const formula = substitute(text(at(activity, `${kind}.dc.formula`)), context, activity);
  const base = arithmetic(formula) ?? 8;
  if (!calculation) return formula || "spell save DC";
  if (!context.actor) return "spell save DC";
  const ability =
    calculation === "spellcasting"
      ? text(at(context.actor, "system.attributes.spellcasting")) || "str"
      : calculation;
  return String(base + proficiency(context.actor) + mod(context.actor, ability));
};
export const attackBonus = (context: RollContext, activity: Data): number | string | undefined => {
  if (!context.actor) return undefined;
  const bonus = arithmetic(
    substitute(text(at(activity, "attack.bonus")) || "0", context, activity),
  );
  if (bonus === undefined) {
    const symbolic = substitute(text(at(activity, "attack.bonus")), context, activity);
    return at(activity, "attack.flat") && parseNotation(`1d20+${symbolic}`).ok
      ? symbolic
      : undefined;
  }
  if (at(activity, "attack.flat")) return bonus;
  return (
    bonus +
    proficiency(context.actor) +
    mod(context.actor, abilityFor(context, activity)) +
    num(at(context.doc, "system.magicalBonus"))
  );
};
export const damagePart = (
  part: Data,
  context: RollContext,
  activity: Data = {},
  base = false,
): RollPart | undefined => {
  let notation = at(part, "custom.enabled")
    ? text(at(part, "custom.formula"))
    : num(part.number) && num(part.denomination)
      ? `${num(part.number)}d${num(part.denomination)}`
      : "";
  if (!notation) return undefined;
  const bonusText = substitute(text(part.bonus).replace(/[−–]/g, "-"), context, activity);
  const bonus = arithmetic(bonusText);
  if (bonusText)
    notation +=
      bonus === undefined
        ? `+${bonusText}`
        : bonus
          ? typeof bonus === "number"
            ? signed(bonus)
            : `+${bonus}`
          : "";
  if (base && context.actor) {
    const modifier =
      mod(context.actor, abilityFor(context, activity)) +
      num(at(context.doc, "system.magicalBonus"));
    if (modifier) notation += signed(modifier);
  }
  notation = substitute(notation, context, activity).replace(/\+-/g, "-").replace(/\s/g, "");
  if (!parseNotation(notation).ok) return undefined;
  return { notation, label: [notation, ...strings(part.types).map(title)].join(" ") };
};
export const damageParts = (context: RollContext, activity: Data): RollPart[] => {
  const parts: RollPart[] = [];
  if (at(activity, "damage.includeBase")) {
    const base = damagePart(object(at(context.doc, "system.damage.base")), context, activity, true);
    if (base) parts.push(base);
  }
  for (const raw of array(at(activity, "damage.parts"))) {
    const part = damagePart(object(raw), context, activity);
    if (part) parts.push(part);
  }
  const healing = damagePart(object(activity.healing), context, activity);
  if (healing) parts.push(healing);
  return parts;
};
export const activityRoll = (context: RollContext, activity: Data): string | undefined => {
  const bonus = activity.type === "attack" ? attackBonus(context, activity) : undefined;
  const parts = [
    ...(bonus === undefined
      ? []
      : [`1d20${bonus ? (typeof bonus === "number" ? signed(bonus) : `+${bonus}`) : ""}`]),
    ...damageParts(context, activity).map((p) => p.notation),
  ];
  const formula = substitute(text(at(activity, "roll.formula")), context, activity);
  if (formula && parseNotation(formula).ok) parts.push(formula);
  const roll = parts.join(" | ");
  return roll && parseNotation(roll).ok ? roll : undefined;
};
export const rolls = (context: RollContext): { name: string; roll: string }[] =>
  activities(context.doc.system).flatMap((activity) => {
    const roll = activityRoll(context, activity);
    return roll ? [{ name: text(activity.name) || text(context.doc.name), roll }] : [];
  });
