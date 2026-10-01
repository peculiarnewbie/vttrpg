import { createRequire } from "node:module";
import { parseNotation } from "../../../src/domain/dice-notation";
import {
  activities,
  array,
  at,
  abilities,
  mod,
  num,
  object,
  proficiency,
  signed,
  skills,
  strings,
  text,
  title,
  type Data,
} from "./data";
import {
  arithmetic,
  attackBonus,
  damagePart,
  damageParts,
  dc,
  substitute,
  type RollContext,
} from "./rolls";

export type ConversionNotes = {
  embeds: Set<string>;
  lookups: Set<string>;
  rolls: Set<string>;
  foundryNotes: number;
};
export const conversionNotes = (): ConversionNotes => ({
  embeds: new Set(),
  lookups: new Set(),
  rolls: new Set(),
  foundryNotes: 0,
});
export type MarkdownContext = RollContext & {
  references: Map<string, { id: string; name: string }>;
  notes: ConversionNotes;
  summon?: Data;
  scales?: Map<string, { id: string; name: string }>;
};
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: { document: Document; close: () => void } };
};
const window = new JSDOM("").window;
const document = window.document;
window.close();
const link = (target: { id: string; name: string } | undefined, label: string): string =>
  target ? `[[ref:${target.id}|${label || target.name}]]` : label;
const unit = (value: unknown): string =>
  ({
    ft: "foot",
    mi: "mile",
    m: "meter",
    minute: "minute",
    hour: "hour",
    day: "day",
    round: "round",
  })[text(value)] ?? text(value);
const affects = (data: unknown): string => {
  const special = text(at(data, "target.affects.special"));
  const count = text(at(data, "target.affects.count"));
  const type = text(at(data, "target.affects.type")) || "creature";
  return special || (!count ? `each ${type}` : `${count} ${type}${count === "1" ? "" : "s"}`);
};
const template = (data: unknown): string => {
  const shape = text(at(data, "target.template.type"));
  const size = text(at(data, "target.template.size"));
  const units = unit(at(data, "target.template.units")) || "foot";
  return shape
    ? `${size}-${units}${["sphere", "cylinder"].includes(shape) ? "-radius" : ""} ${title(shape)}`
    : "area";
};
const activityOf = (context: MarkdownContext, options: string): Data => {
  const id = /activity=([^\s]+)/.exec(options)?.[1];
  const selected = id ? at(context.doc.system, `activities.${id}`) : undefined;
  const available = activities(context.doc.system);
  // A copied item can retain the original activity id in its description.
  return object(selected ?? (!id || available.length === 1 ? available[0] : undefined));
};

export const readableFormula = (formula: string): string =>
  formula
    .replace(
      /@abilities\.(str|dex|con|int|wis|cha)\.mod/g,
      (_, ability: string) => `your ${abilities[ability]} modifier`,
    )
    .replace(/@classes\.([\w-]+)\.levels/g, (_, name: string) => `your ${title(name)} level`)
    .replace(/@details\.level/g, "your character level")
    .replace(/@flags\.dnd5e\.summon\.mod/g, "the summoner's spellcasting ability modifier")
    .replace(
      /@flags\.dnd5e\.summon\.([\w.-]+)/g,
      (_, name: string) => `the summoner's ${name.replace(/[-.]/g, " ")}`,
    )
    .replace(/@scale\.[\w-]+\.([\w-]+)/g, (_, name: string) => name.replace(/-/g, " "))
    .replace(/@spell_mod/g, "your spellcasting ability modifier")
    .replace(/@spell_level/g, "the spell’s level")
    .replace(/@spell_attack/g, "your spell attack modifier")
    .replace(/@spell_dc/g, "your spell save DC")
    .replace(/@proficiency/g, "your Proficiency Bonus")
    .replace(/@([\w.-]+)/g, (_, name: string) => name.replace(/[._-]/g, " "));

const lookup = (expression: string, fallback: string, context: MarkdownContext): string => {
  const [ref, ...options] = expression.trim().split(/\s+/);
  const activity = activityOf(context, options.join(" "));
  const path = ref.replace(/^@/, "");
  const scale = context.scales?.get(path) ?? context.scales?.get(path.replace(/\.die$/, ""));
  if (scale) return link(scale, `${scale.name} by level`);
  let value = "";
  if (path.startsWith("abilities.") && path.endsWith(".dc") && context.actor)
    value = String(8 + proficiency(context.actor) + mod(context.actor, path.split(".")[1]));
  else if (path === "name") value = text((context.actor ?? context.doc).name);
  else if (path === "labels.description.affects") value = affects(context.doc.system);
  else if (path === "labels.description.template") value = template(context.doc.system);
  else if (path === "attributes.spell.dc")
    value = substitute("@attributes.spell.dc", context, activity);
  else if (path === "save.dc.value" || path === "check.dc.value")
    value = dc(context, activity, path.startsWith("save") ? "save" : "check");
  else if (path === "target.affects.labels.statblock") value = affects(activity);
  else if (path === "healing.formula")
    value =
      damagePart(object(activity.healing), context, activity)?.notation ||
      substitute(text(at(activity, "healing.bonus")), context, activity);
  else if (path === "item.range.reach") value = text(at(context.doc.system, "range.reach")) || "5";
  else if (path === "item.level") value = text(at(context.doc, "system.level"));
  else if (path.startsWith("skills.") && path.endsWith(".passive") && context.actor) {
    const skill = object(at(context.actor, `system.skills.${path.split(".")[1]}`));
    value = String(
      10 + mod(context.actor, text(skill.ability)) + num(skill.value) * proficiency(context.actor),
    );
  } else {
    const data = path.startsWith("item.")
      ? at(context.doc.system, path.slice(5))
      : (at(activity, path) ?? at(context.actor?.system, path) ?? at(context.doc.system, path));
    value = Array.isArray(data)
      ? strings(data)
          .map((s) => abilities[s] ?? title(s))
          .join(" or ")
      : text(data);
    if (path.endsWith(".units")) value = unit(value);
  }
  if (!value) {
    context.notes.lookups.add(`${text(context.doc.name)}: ${expression}`);
    value = fallback || readableFormula(ref);
  }
  value = readableFormula(substitute(value, context, activity));
  if (options.includes("lowercase")) value = value.toLowerCase();
  if (options.includes("capitalize")) value = value.charAt(0).toUpperCase() + value.slice(1);
  return value;
};

const inlineRoll = (
  command: string,
  args: string,
  label: string,
  context: MarkdownContext,
): string => {
  const activity = activityOf(context, args);
  if (["save", "check", "skill"].includes(command)) {
    const ability = /ability=([^\s]+)/.exec(args)?.[1] || text(at(activity, `${command}.ability`));
    const skill = /skill=([^\s]+)/.exec(args)?.[1];
    const dcText = /dc=([^\s]+)/.exec(args)?.[1];
    const value = dcText
      ? substitute(dcText, context, activity)
      : dc(context, activity, command === "save" ? "save" : "check");
    return (
      label ||
      `${dcText || at(activity, `${command}.dc.formula`) ? `${value === "spell save DC" ? "your spell save DC" : `DC ${readableFormula(value)}`} ` : ""}${abilities[ability] ?? title(ability)}${skill ? ` (${skills[skill] ?? title(skill)})` : ""} ${command === "save" ? "saving throw" : "check"}`.trim()
    );
  }
  if (command === "item") {
    const target = args.replace(/^\./, "").trim();
    const item = array(context.actor?.items)
      .map(object)
      .find((item) => item._id === target || item.name === target);
    return label || text(item?.name) || args;
  }
  if (command === "tool") {
    const [tool, ability, target] = args.split(/\s+/);
    return `${target ? `DC ${target} ` : ""}${abilities[ability] ?? title(ability)} check using ${tool === "thief" ? "Thieves’ Tools" : title(tool)}`;
  }
  if (command === "award") return label || args.replace(/(\d)([A-Z]+)/g, "$1 $2");
  if (command === "attack") {
    const bonus = attackBonus(context, activity);
    const range = object(at(context.doc.system, "range"));
    const type =
      text(at(activity, "attack.type.value")) ||
      (text(at(context.doc.system, "type.value")).endsWith("R") ? "ranged" : "melee");
    return `${title(type)} Attack Roll: ${bonus === undefined ? "your attack modifier" : typeof bonus === "number" ? signed(bonus) : readableFormula(bonus)}${args.includes("extended") ? `, ${type === "ranged" ? `range ${text(range.value) || text(at(activity, "range.value"))}${range.long ? `/${text(range.long)}` : ""} ft.` : `reach ${text(range.reach) || "5"} ft.`}` : ""}`;
  }
  if (["damage", "healing"].includes(command) && !/^\s*(?:\d|\(|@)/.test(args)) {
    return (
      damageParts(context, activity)
        .map((part) => `[[r:${part.notation}|${part.label}]]`)
        .join(" plus ") ||
      label ||
      `${command} described by this feature`
    );
  }
  let formula = args
    .replace(/[−–]/g, "-")
    .split("#")[0]
    .replace(/\s+(?:type=\w+|average|extended|temp|activity=[^\s]+|[a-z]+)(?=\s|$)/g, "")
    .trim();
  formula = substitute(formula, context, activity);
  // Foundry's success-count suffixes evaluate outcomes; retain only the dice.
  formula = formula.replace(/cs(?:[<>]=?|=)?\d+/g, "");
  formula = formula.replace(/\(([^()]+)\)(?=d)/g, (whole, inner: string) => {
    const n = arithmetic(inner);
    return n === undefined ? whole : String(n);
  });
  const type =
    /(?:type=|\s)(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder|healing)\b/.exec(
      args,
    )?.[1];
  const notation = formula.replace(/\s/g, "");
  const rollLabel = label || args.split("#")[1] || `${formula}${type ? ` ${title(type)}` : ""}`;
  if (parseNotation(notation).ok) return `[[r:${notation}|${rollLabel}]]`;
  // Multipliers stay prose beside a roll the app can represent.
  const multiplied = /^(\d*d\d+)\s*\*\s*(\d+)$/.exec(formula);
  if (multiplied && parseNotation(multiplied[1]).ok)
    return `[[r:${multiplied[1]}|${multiplied[1]}]] × ${multiplied[2]}`;
  context.notes.rolls.add(`${text(context.doc.name)}: /${command} ${args}`);
  return label || readableFormula(formula || args);
};

const enrich = (input: string, context: MarkdownContext): string =>
  input
    .replace(
      /\[\[lookup\s+([^\]]+)\]\](?:\{([^}]+)\})?/g,
      (_, expression: string, fallback: string = "") => lookup(expression, fallback, context),
    )
    .replace(
      /@(?:UUID|Compendium)\[([^\]]+)\](?:\{([^}]+)\})?/g,
      (_, uuid: string, label: string = "") => {
        const target = context.references.get(uuid.split("#")[0]);
        return link(target, label || target?.name || "Referenced content");
      },
    )
    .replace(/@Embed\[([^\]]+)\](?:\{([^}]+)\})?/g, (_, args: string, label: string = "") => {
      const target = context.references.get(args.split(/\s/)[0]);
      if (target) return link(target, label);
      context.notes.embeds.add(args.split(/\s/)[0]);
      return label;
    })
    .replace(
      /&Reference\[([^\]}]+)[\]}](?:\{([^}]+)\})?/g,
      (_, ref: string, label: string = "") => {
        const name = ref.replace(/\s+\w+=.*$/, "");
        return link(
          context.references.get(`reference:${name.toLowerCase().replace(/\s/g, "")}`),
          label || name,
        );
      },
    )

    .replace(
      /\[\[\/(\w+)\s*([^\]]*)\]\](?:\{([^}]+)\})?/g,
      (_, command: string, args: string, label: string = "") =>
        inlineRoll(command, args, label, context),
    )
    .replace(
      /\[\[(?!r:|ref:)([^\]]+)\]\](?:\{([^}]+)\})?/g,
      (_, expression: string, label: string = "") => {
        const formula = substitute(expression, context);
        const n = arithmetic(formula);
        if (n !== undefined) return label ? `${label}: ${n}` : String(n);
        if (parseNotation(formula).ok && /\d*d\d+/.test(formula))
          return `[[r:${formula}|${label || formula}]]`;
        context.notes.lookups.add(`${text(context.doc.name)}: ${expression}`);
        return label || readableFormula(formula);
      },
    );

export const markdown = (html: string, context: MarkdownContext): string => {
  const root = document.createElement("template");
  root.innerHTML = html;
  for (const node of root.content.querySelectorAll(
    "img, picture, figure, video, audio, script, style, .secret, .fvtt",
  )) {
    if (node.classList.contains("secret") || node.classList.contains("fvtt"))
      context.notes.foundryNotes++;
    node.remove();
  }
  for (const node of root.content.querySelectorAll("p"))
    if (/^\s*Token artwork by/i.test(node.textContent ?? "")) {
      context.notes.foundryNotes++;
      node.remove();
    }
  const children = (node: Node): string => Array.from(node.childNodes).map(render).join("");
  const render = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === "table") {
      const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).map((cell) =>
          children(cell).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|"),
        ),
      );
      const width = Math.max(0, ...rows.map((row) => row.length));
      if (!width) return "";
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      return `\n\n${[line(rows[0]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
    }
    if (tag === "ul" || tag === "ol")
      return `\n\n${Array.from(element.children)
        .map(
          (item, i) =>
            `${tag === "ul" ? "-" : `${i + 1}.`} ${children(item).trim().replace(/\n/g, "\n  ")}`,
        )
        .join("\n")}\n\n`;
    const value = children(node);
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${value.trim()}\n\n`;
    if (tag === "strong" || tag === "b")
      return value.trim() ? `**${value.trim()}**${value.endsWith(" ") ? " " : ""}` : "";
    if (tag === "em" || tag === "i")
      return value.trim() ? `*${value.trim()}*${value.endsWith(" ") ? " " : ""}` : "";
    if (tag === "blockquote")
      return `\n\n${value
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    if (tag === "summary")
      return `\n\n#### ${value.replace(/\s*\(click to expand\)/gi, "").trim()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      return href.startsWith("https://") && !/\.(?:png|webp|jpe?g|svg)\b/i.test(href)
        ? `[${value}](${href})`
        : value;
    }
    if (["p", "div", "section", "aside", "dl", "dt", "dd"].includes(tag))
      return `\n\n${value.trim()}\n\n`;
    return value;
  };
  return (
    enrich(children(root.content), context)
      .split(/(\[\[(?:r|ref):[^\]]+\]\])/g)
      .map((part) =>
        part.startsWith("[[")
          ? part
          : part
              .replace(
                /\b(\d+d\d+)\s+((?:Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder)\s+damage)/gi,
                (_, dice: string, label: string) =>
                  parseNotation(dice).ok ? `[[r:${dice}|${dice} ${label}]]` : `${dice} ${label}`,
              )
              .replace(
                /(Hit Points equal to |regains? )(\d+d\d+)(?=\s+(?:plus|Hit Points))/gi,
                (_, prefix: string, dice: string) =>
                  parseNotation(dice).ok ? `${prefix}[[r:${dice}|${dice}]]` : `${prefix}${dice}`,
              ),
      )
      .join("")
      .replace(/DC (?:your )?spell save DC/g, "your spell save DC")
      // A generated "… 5 ft." followed by the upstream sentence's own full stop.
      .replace(/\bft\.\./g, "ft.")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
};
