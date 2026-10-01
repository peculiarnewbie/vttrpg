import { createHash } from "node:crypto";
import { firstPartySystems } from "../../../src/domain/systems";
import { slugify } from "../../../src/domain/entry-id";
import { compendiumLimits } from "../../../src/domain/compendium";
import type { BundleEntry, SourceBundle } from "../../../src/domain/source-bundle";
import type { ListRowValue, CharacterValue } from "../../../src/domain/schemas";
import { upstream } from "../sources";
import {
  abilities,
  activities,
  array,
  at,
  licensed,
  mod,
  num,
  object,
  proficiency,
  readDocuments,
  readSpellLists,
  signed,
  sizes,
  skills,
  strings,
  text,
  title,
  type Data,
  type Loaded,
} from "./data";
import { conversionNotes, markdown, readableFormula, type MarkdownContext } from "./markdown";
import { activityRoll, arithmetic, damagePart, rolls, substitute } from "./rolls";

const library = firstPartySystems.find((item) => item.source.id === "srd52")!;
const monsterTypes = library.system.entryTypes
  .find((t) => t.id === "monster")!
  .fields.find((f) => f.key === "type")!.options!;
const armorCategories: Record<string, string> = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
  shield: "Shield",
};
const weaponCategories: Record<string, string> = {
  simpleM: "Simple Melee",
  simpleR: "Simple Ranged",
  martialM: "Martial Melee",
  martialR: "Martial Ranged",
};
const weaponProperties: Record<string, string> = {
  amm: "Ammunition",
  fin: "Finesse",
  hvy: "Heavy",
  lgt: "Light",
  lod: "Loading",
  rch: "Reach",
  thr: "Thrown",
  two: "Two-Handed",
  ver: "Versatile",
};
const schools: Record<string, string> = {
  abj: "Abjuration",
  con: "Conjuration",
  div: "Divination",
  enc: "Enchantment",
  evo: "Evocation",
  ill: "Illusion",
  nec: "Necromancy",
  trs: "Transmutation",
};
const typeOf = ({ doc, pack, file }: Loaded): string | undefined => {
  const system = doc.system ?? {};
  if (pack === "actors24") {
    if (doc.type !== "npc") return undefined;
    const kind = text(at(system, "details.type.value"));
    return !kind || kind === "object" || (kind === "custom" && !file.includes("/companions/"))
      ? undefined
      : "monster";
  }
  if (pack === "spells24" && doc.type !== "spell") return undefined;
  if (pack === "equipment24" && text(system.container)) return undefined;
  if (pack === "content24" || pack === "tables24") return "rule";
  if (pack === "classes24")
    return doc.type === "class" || doc.type === "subclass" ? doc.type : "feature";
  if (pack === "origins24")
    return doc.type === "race" ? "species" : doc.type === "background" ? "background" : "feature";
  if (pack === "feats24") return "feat";
  if (pack === "monsterfeatures24") return "feature";
  if (doc.type === "spell") return "spell";
  if (text(system.rarity) && system.rarity !== "mundane") return "magic-item";
  if (doc.type === "weapon") return "weapon";
  if (armorCategories[text(at(system, "type.value"))]) return "armor";
  return "gear";
};
const uuid = (item: Loaded): string =>
  `Compendium.dnd5e.${item.pack}.${item.pack === "actors24" ? "Actor" : item.pack === "content24" ? "JournalEntry" : item.pack === "tables24" ? "RollTable" : "Item"}.${item.doc._id}`;
const description = (doc: Data): string => text(at(doc.system, "description.value"));
const distance = (data: unknown, context?: MarkdownContext): string => {
  const units = text(at(data, "units"));
  const raw = text(at(data, "value"));
  const value = context ? text(arithmetic(substitute(raw, context))) || raw : raw;
  return (
    text(at(data, "special")) ||
    {
      self: "Self",
      touch: "Touch",
      any: "Unlimited",
      spec: "Special",
      inst: "Instantaneous",
      perm: "Until dispelled",
    }[units] ||
    `${value} ${{ ft: "feet", mi: "miles", minute: "minutes", hour: "hours", day: "days", round: "rounds", turn: "turns" }[units] ?? units}`.trim()
  );
};
const labeled = (body: string, label: string): string => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`\\*\\*${escaped}:?\\s*\\*\\*\\s*([^\\n]+)`, "i").exec(body)?.[1]?.trim() ?? ""
  ).replace(/^\|\s*|\s*\|$/g, "");
};
const grants = (system: unknown): { uuid: string; level: number }[] =>
  array(at(system, "advancement")).flatMap((raw) => {
    const advancement = object(raw);
    return advancement.type === "ItemGrant"
      ? array(at(advancement, "configuration.items")).map((item) => ({
          uuid: text(at(item, "uuid")),
          level: num(advancement.level),
        }))
      : [];
  });
const traitsText = (data: unknown): string =>
  [...strings(at(data, "value")).map(title), text(at(data, "custom"))].filter(Boolean).join(", ");
const movement = (data: unknown): string =>
  ["walk", "burrow", "climb", "fly", "swim"]
    .flatMap((kind) => {
      const value = text(at(data, kind));
      return value && value !== "0"
        ? [
            `${kind === "walk" ? "" : `${title(kind)} `}${value} ft.${kind === "fly" && at(data, "hover") ? " (hover)" : ""}`,
          ]
        : [];
    })
    .join(", ");

const monsterFields = (context: MarkdownContext): Record<string, CharacterValue> => {
  const doc = context.doc;
  const system = object(doc.system);
  const attributes = object(system.attributes);
  const cr = num(at(system, "details.cr"));
  const prof = proficiency(doc);
  const dex = mod(doc, "dex");
  const fields: Record<string, CharacterValue> = {
    size: sizes[text(at(system, "traits.size"))] ?? "",
    type: monsterTypes.includes(title(at(system, "details.type.value")))
      ? title(at(system, "details.type.value"))
      : "",
    alignment: text(at(system, "details.alignment")),
    cr,
    cr_label: { "0.125": "1/8", "0.25": "1/4", "0.5": "1/2" }[String(cr)] ?? String(cr),
    hp: `${text(at(attributes, "hp.max"))}${at(attributes, "hp.formula") ? ` (${text(at(attributes, "hp.formula"))})` : ""}`,
    speed: movement(attributes.movement),
    initiative: signed(
      mod(doc, text(at(attributes, "init.ability")) || "dex") +
        (arithmetic(substitute(text(at(attributes, "init.bonus")) || "0", { doc, actor: doc })) ??
          0),
    ),
    saves: Object.entries(object(system.abilities))
      .flatMap(([key, value]) =>
        num(at(value, "proficient"))
          ? [
              `${abilities[key]} ${signed(mod(doc, key) + prof * num(at(value, "proficient")) + (arithmetic(text(at(value, "bonuses.save"))) ?? 0))}`,
            ]
          : [],
      )
      .join(", "),
    skills: Object.entries(object(system.skills))
      .flatMap(([key, value]) =>
        num(at(value, "value"))
          ? [
              `${skills[key]} ${signed(mod(doc, text(at(value, "ability"))) + prof * num(at(value, "value")) + (arithmetic(text(at(value, "bonuses.check"))) ?? 0))}`,
            ]
          : [],
      )
      .join(", "),
    vulnerabilities: traitsText(at(system, "traits.dv")),
    resistances: traitsText(at(system, "traits.dr")),
    immunities: [traitsText(at(system, "traits.di")), traitsText(at(system, "traits.ci"))]
      .filter(Boolean)
      .join("; "),
    languages: traitsText(at(system, "traits.languages")),
  };
  const xp = [
    10, 200, 450, 700, 1100, 1800, 2300, 2900, 3900, 5000, 5900, 7200, 8400, 10000, 11500, 13000,
    15000, 18000, 20000, 22000, 25000, 33000, 41000, 50000, 62000, 75000, 90000, 105000, 120000,
    135000, 155000,
  ];
  fields.xp = String({ "0.125": 25, "0.25": 50, "0.5": 100 }[String(cr)] ?? xp[cr] ?? "");
  for (const key of Object.keys(abilities)) fields[key] = num(at(system, `abilities.${key}.value`));
  const senses = object(at(attributes, "senses.ranges") ?? attributes.senses);
  const perception = object(at(system, "skills.prc"));
  fields.senses = [
    ...["blindsight", "darkvision", "tremorsense", "truesight"].flatMap((key) =>
      num(senses[key]) ? [`${title(key)} ${text(senses[key])} ft.`] : [],
    ),
    text(at(attributes, "senses.special")),
    `Passive Perception ${10 + mod(doc, "wis") + num(perception.value) * prof + (arithmetic(text(at(perception, "bonuses.passive"))) ?? 0)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const licensedItems = array(doc.items)
    .map(object)
    .filter((item) => licensed({ system: object(item.system) }));
  let ac = at(attributes, "ac.flat") == null ? 10 + dex : num(at(attributes, "ac.flat"));
  let shield = 0;
  if (at(attributes, "ac.calc") === "default") {
    for (const item of licensedItems.filter((item) => at(item.system, "equipped"))) {
      const armor = object(at(item.system, "armor"));
      const kind = text(at(item.system, "type.value"));
      if (kind === "shield") shield += num(armor.value) + num(armor.magicalBonus);
      else if (armorCategories[kind])
        ac =
          num(armor.value) +
          Math.min(dex, armor.dex == null ? dex : num(armor.dex)) +
          num(armor.magicalBonus);
    }
  }
  if (at(attributes, "ac.calc") === "mage") ac = 13 + dex;
  if (at(attributes, "ac.calc") === "custom")
    ac = arithmetic(substitute(text(at(attributes, "ac.formula")), { doc, actor: doc })) ?? ac;
  fields.ac = String(ac + shield);
  const summon = context.summon;
  if (summon) {
    const display = (value: unknown) =>
      readableFormula(
        text(value)
          .replace(/@item.level/g, "@spell_level")
          .replace(/\*/g, "×"),
      );
    if (at(summon, "bonuses.ac")) fields.ac = `${fields.ac} + ${display(at(summon, "bonuses.ac"))}`;
    if (at(summon, "bonuses.hp"))
      fields.hp = `${text(at(attributes, "hp.max"))} + ${display(at(summon, "bonuses.hp"))}`;
    if (at(summon, "bonuses.hd") && /d\d+/.test(text(at(attributes, "hp.formula"))))
      fields.hp += ` (Hit Dice: ${display(at(summon, "bonuses.hd"))} d${/d(\d+)/.exec(text(at(attributes, "hp.formula")))?.[1]})`;
  }
  const overrides = object(at(doc, "flags.dnd5e.statBlockOverride"));
  for (const key of ["ac", "hp", "speed", "initiative", "saves", "skills", "senses", "languages"])
    if (overrides[key]) fields[key] = markdown(text(overrides[key]), context);
  if (at(system, "details.cr") == null) {
    delete fields.cr;
    delete fields.xp;
    fields.cr_label = text(overrides.cr) || "—";
  }
  const rows: Record<string, { name: string; roll?: string; text?: string }[]> = {
    traits: [],
    actions: [],
    bonus_actions: [],
    reactions: [],
    legendary: [],
  };
  for (const item of licensedItems) {
    // Prepared spell copies and worn equipment are represented by the casting/attack feature.
    if (["spell", "equipment", "loot", "container"].includes(text(item.type))) continue;
    const itemContext = { ...context, doc: item, actor: doc };
    const acts = activities(item.system);
    const kind = text(at(acts[0], "activation.type"));
    const key =
      strings(at(item.system, "properties")).includes("trait") || !acts.length
        ? "traits"
        : ({ bonus: "bonus_actions", reaction: "reactions", legendary: "legendary" }[kind] ??
          "actions");
    const body = markdown(description(item), itemContext);
    const roll = acts.map((a) => activityRoll(itemContext, a)).find(Boolean);
    const recharge = array(at(item.system, "uses.recovery"))
      .map(object)
      .find((r) => r.period === "recharge");
    let name = text(item.name);
    if (recharge) name += ` (Recharge ${text(recharge.formula)}–6)`;
    if (at(item.system, "identifier") === "legendary-resistance")
      name += ` (${text(at(system, "resources.legres.max"))}/Day)`;
    rows[key].push({ name, ...(roll ? { roll } : {}), ...(body ? { text: body } : {}) });
  }
  return { ...fields, ...rows };
};

const fieldsFor = (
  type: string,
  context: MarkdownContext,
  loaded: Loaded,
  references: Map<string, { id: string; name: string }>,
  parents: Map<string, { className: string; subclass?: string; level: number }>,
  classes: Map<string, string>,
  body: string,
): Record<string, CharacterValue> => {
  const doc = context.doc,
    system = object(doc.system);
  const fields: Record<string, CharacterValue> = {};
  const set = (key: string, value: CharacterValue | undefined) => {
    if (value !== undefined && value !== "") fields[key] = value;
  };
  // Stat blocks leave unused lines out instead of storing empty text.
  if (type === "monster")
    return Object.fromEntries(
      Object.entries(monsterFields(context)).filter(
        ([, value]) => value !== "" && !(Array.isArray(value) && value.length === 0),
      ),
    );
  if (type === "spell") {
    set("level", num(system.level));
    set("school", schools[text(system.school)]);
    const properties = strings(system.properties);
    set(
      "components",
      properties.flatMap((p) => ({ vocal: ["V"], somatic: ["S"], material: ["M"] })[p] ?? []),
    );
    set(
      "properties",
      properties.flatMap(
        (p) => ({ concentration: ["Concentration"], ritual: ["Ritual"] })[p] ?? [],
      ),
    );
    const activation = object(system.activation);
    set(
      "casting",
      `${activation.value ? `${text(activation.value)} ` : ""}${{ action: "Action", bonus: "Bonus Action", reaction: "Reaction" }[text(activation.type)] ?? title(activation.type)}${activation.condition ? `, ${text(activation.condition)}` : ""}`,
    );
    set("range", distance(system.range));
    set("duration", distance(system.duration, context));
    set("material", text(at(system, "materials.value")));
    set("rolls", rolls(context));
  } else if (["weapon", "armor", "gear"].includes(type)) {
    set(
      "cost",
      `${text(at(system, "price.value"))} ${text(at(system, "price.denomination"))}`.trim(),
    );
    set("weight", `${text(at(system, "weight.value"))} ${text(at(system, "weight.units"))}`.trim());
    const kind = text(at(system, "type.value"));
    if (type === "weapon") {
      set("category", weaponCategories[kind]);
      set("damage", damagePart(object(at(system, "damage.base")), context)?.notation);
      set("damage_type", strings(at(system, "damage.base.types")).map(title).join(", "));
      const props = strings(system.properties).flatMap((p) =>
        weaponProperties[p] ? [weaponProperties[p]] : [],
      );
      if (at(system, "range.long")) props.push("Range");
      set("properties", props);
      set("mastery", title(system.mastery));
      const versatile = damagePart(object(at(system, "damage.versatile")), context)?.notation;
      set(
        "property_notes",
        [
          versatile ? `Versatile (${versatile})` : "",
          at(system, "range.long")
            ? `Range ${text(at(system, "range.value"))}/${text(at(system, "range.long"))}`
            : "",
          at(system, "range.reach") ? `Reach ${text(at(system, "range.reach"))} feet` : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
    } else if (type === "armor") {
      set("category", armorCategories[kind]);
      const dex = at(system, "armor.dex");
      set(
        "ac",
        kind === "shield"
          ? `+${text(at(system, "armor.value"))}`
          : `${text(at(system, "armor.value"))}${kind === "heavy" ? "" : ` + Dex modifier${dex == null ? "" : ` (max ${text(dex)})`}`}`,
      );
      set("strength", text(system.strength));
      set(
        "stealth",
        strings(system.properties).includes("stealthDisadvantage") ? "Disadvantage" : "",
      );
    } else {
      let category =
        doc.type === "tool"
          ? "Tool"
          : kind === "ammo"
            ? "Ammunition"
            : kind === "vehicle"
              ? "Vehicle"
              : doc.type === "container" && /pack$/i.test(text(doc.name))
                ? "Pack"
                : "Adventuring Gear";
      if (loaded.file.includes("/arcane-focus/")) category = "Arcane Focus";
      if (loaded.file.includes("/druidic-focus/")) category = "Druidic Focus";
      if (loaded.file.includes("/holy-symbol/")) category = "Holy Symbol";
      set("category", category);
    }
  } else if (type === "magic-item") {
    const kind = text(at(system, "type.value"));
    set(
      "category",
      loaded.file.includes("/weapons/staff/")
        ? "Staff"
        : doc.type === "weapon"
          ? "Weapon"
          : armorCategories[kind]
            ? "Armor"
            : ({
                potion: "Potion",
                ring: "Ring",
                rod: "Rod",
                staff: "Staff",
                scroll: "Scroll",
                wand: "Wand",
              }[kind] ?? "Wondrous Item"),
    );
    const rarity = system.rarity === "veryRare" ? "Very Rare" : title(system.rarity);
    if (["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"].includes(rarity))
      set("rarity", rarity);
    set("attunement", system.attunement === "required" ? "Requires Attunement" : "");
    set("rolls", rolls(context));
  } else if (type === "class" || type === "subclass") {
    const granted = grants(system);
    set("features", [
      ...new Set(
        granted.flatMap((g) => {
          const ref = references.get(g.uuid);
          return ref && ref.id.split("/")[1] === "feature" ? [ref.id] : [];
        }),
      ),
    ]);
    const scales = array(system.advancement)
      .map(object)
      .filter((a) => a.type === "ScaleValue");
    set(
      "levels",
      Array.from({ length: 20 }, (_, i): ListRowValue => {
        const level = i + 1;
        const featureNames = granted
          .filter((g) => g.level === level)
          .map((g) => references.get(g.uuid)?.name)
          .filter(Boolean);
        for (const a of array(system.advancement)
          .map(object)
          .filter((a) => num(a.level) === level)) {
          if (a.type === "AbilityScoreImprovement")
            featureNames.push(level === 19 ? "Epic Boon" : "Ability Score Improvement");
          if (a.type === "Subclass") featureNames.push("Subclass");
        }
        if (type === "subclass") return { level, features: featureNames.join(", ") };
        const extra = scales
          .flatMap((scale) => {
            const entries = Object.entries(object(at(scale, "configuration.scale")))
              .filter(([key]) => num(key) <= level)
              .sort(([a], [b]) => num(b) - num(a));
            const value = object(entries[0]?.[1]);
            const display =
              text(value.value) ||
              (value.faces ? `${text(value.number) || "1"}d${text(value.faces)}` : "");
            return display
              ? [`${text(scale.title) || title(at(scale, "configuration.identifier"))}: ${display}`]
              : [];
          })
          .join("; ");
        return {
          level,
          proficiency: signed(2 + Math.floor(i / 4)),
          features: featureNames.join(", "),
          extra,
        };
      }),
    );
    if (type === "subclass") set("class", classes.get(text(system.classIdentifier)));
    else {
      set("hit_die", `1${text(at(system, "hd.denomination"))}`);
      set(
        "primary",
        strings(at(system, "primaryAbility.value"))
          .map((s) => abilities[s])
          .join(" and "),
      );
      for (const [key, label] of [
        ["saves", "Saving Throw Proficiencies"],
        ["skills", "Skill Proficiencies"],
        ["weapons", "Weapon Proficiencies"],
        ["armor", "Armor Training"],
        ["tools", "Tool Proficiencies"],
        ["equipment", "Starting Equipment"],
      ])
        set(key, labeled(body, label));
    }
  } else if (type === "feature") {
    const parent = parents.get(uuid(loaded));
    if (parent) {
      set("class", parent.className);
      set("level", parent.level);
      set("subclass", parent.subclass);
    } else
      set(
        "level",
        at(system, "prerequisites.level") == null
          ? undefined
          : num(at(system, "prerequisites.level")),
      );
    set("rolls", rolls(context));
  } else if (type === "species") {
    set("creature_type", labeled(body, "Creature Type") || title(at(system, "type.value")));
    set("size", labeled(body, "Size"));
    set("speed", labeled(body, "Speed") || movement(system.movement));
    set(
      "traits",
      body.split(/\n\n/).flatMap((paragraph) => {
        const match = /^\*\*([^*]+)\.\s*\*\*\s*(.*)$/s.exec(paragraph);
        return match ? [{ name: match[1].trim(), text: match[2] }] : [];
      }),
    );
  } else if (type === "background") {
    for (const [key, label] of [
      ["abilities", "Ability Scores"],
      ["skills", "Skill Proficiencies"],
      ["tool", "Tool Proficiency"],
      ["equipment", "Equipment"],
    ])
      set(key, labeled(body, label));
    const feat = grants(system)
      .map((g) => references.get(g.uuid))
      .find((ref) => ref?.id.split("/")[1] === "feat");
    set("feat", feat?.id);
  } else if (type === "feat") {
    set(
      "category",
      {
        origin: "Origin",
        general: "General",
        fightingStyle: "Fighting Style",
        epicBoon: "Epic Boon",
      }[text(at(system, "type.subtype"))] ??
        (loaded.file.includes("/general-feats/") ? "General" : undefined),
    );
    set("prerequisite", text(system.requirements));
    set("repeatable", at(system, "prerequisites.repeatable") ? "Yes" : "No");
    set("rolls", rolls(context));
  } else if (type === "rule") set("category", "Glossary");
  return fields;
};

const entryBytes = (entry: BundleEntry): number =>
  new TextEncoder().encode(
    JSON.stringify({
      ...entry,
      rev: Number.MAX_SAFE_INTEGER,
      licence: library.source.licence,
      sourceVersion: 2147483647,
      sourceRev: Number.MAX_SAFE_INTEGER,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).byteLength;
const textChunks = (body: string): string[] => {
  const chunks: string[] = [];
  for (const paragraph of body.split(/\n\n/)) {
    if (paragraph.length <= 6000) {
      if (paragraph) chunks.push(paragraph);
      continue;
    }
    const lines = paragraph.split("\n");
    const tableHeader =
      lines[0].startsWith("|") && /^\|[\s|:-]+\|$/.test(lines[1] ?? "")
        ? `${lines[0]}\n${lines[1]}`
        : "";
    let chunk = "";
    for (const line of lines) {
      if (line.length > 6000) {
        if (chunk) {
          chunks.push(chunk);
          chunk = "";
        }
        const words = line.match(/\[\[(?:ref|r):[^\]]+\]\]|\S+/g) ?? [];
        for (const word of words) {
          if (chunk.length + word.length > 6000) {
            chunks.push(chunk);
            chunk = "";
          }
          chunk += `${chunk ? " " : ""}${word}`;
        }
      } else {
        if (chunk.length + line.length > 6000) {
          chunks.push(chunk);
          chunk = tableHeader;
        }
        chunk += `${chunk ? "\n" : ""}${line}`;
      }
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks;
};

const splitEntry = (entry: BundleEntry): BundleEntry[] => {
  if (
    entry.body.length <= compendiumLimits.body &&
    entryBytes(entry) <= compendiumLimits.entryBytes
  )
    return [entry];
  const parts: BundleEntry[] = [{ ...entry, body: "", fields: {} }];
  const fits = (part: BundleEntry) =>
    part.body.length <= compendiumLimits.body - 1000 &&
    entryBytes(part) <= compendiumLimits.entryBytes - 1000;
  const append = (update: (part: BundleEntry) => BundleEntry) => {
    let part = parts[parts.length - 1];
    let candidate = update(part);
    if (!fits(candidate)) {
      part = { ...entry, body: "", fields: {} };
      candidate = update(part);
      if (!fits(candidate)) throw new Error(`Cannot fit a single text/field unit in ${entry.id}`);
      parts.push(candidate);
    } else parts[parts.length - 1] = candidate;
  };
  for (const [key, value] of Object.entries(entry.fields)) {
    if (Array.isArray(value) && value.some((row) => typeof row === "object")) {
      for (const raw of value) {
        const row = object(raw);
        const chunks =
          typeof row.text === "string" && row.text.length > 6000 ? textChunks(row.text) : [];
        const rows = chunks.length
          ? chunks.map((text, i) => ({
              ...row,
              name: `${String(row.name)} (${i + 1}/${chunks.length})`,
              text,
            }))
          : [raw];
        for (const item of rows)
          append((part) => ({
            ...part,
            fields: { ...part.fields, [key]: [...array(part.fields[key]), item] as CharacterValue },
          }));
      }
    } else if (typeof value === "string" && value.length > 6000) {
      for (const chunk of textChunks(value))
        append((part) => ({
          ...part,
          fields: { ...part.fields, [key]: [part.fields[key], chunk].filter(Boolean).join("\n\n") },
        }));
    } else append((part) => ({ ...part, fields: { ...part.fields, [key]: value } }));
  }
  for (const chunk of textChunks(entry.body))
    append((part) => ({ ...part, body: [part.body, chunk].filter(Boolean).join("\n\n") }));
  const numbered = parts.map((part, i) => ({
    ...part,
    id: i ? `${entry.id}-${i + 1}` : entry.id,
    name: `${entry.name} (${i + 1}/${parts.length})`,
  }));
  return numbered.map((part) => ({
    ...part,
    body: `${part.body}${part.body ? "\n\n" : ""}${numbered
      .filter((p) => p.id !== part.id)
      .map((p) => `[[ref:${p.id}|${p.name}]]`)
      .join(" · ")}`,
  }));
};

export const importSrd52From = (dir: string, revision: string): SourceBundle => {
  const loaded = readDocuments(dir);
  const skipped: Record<string, number> = {};
  const selected: (Loaded & { typeId: string; id: string })[] = [];
  const seen = new Set<string>();
  for (const item of loaded) {
    const typeId = licensed(item.doc) ? typeOf(item) : undefined;
    if (!typeId) {
      const reason = `${item.pack}: ${licensed(item.doc) ? (item.pack === "equipment24" && text(at(item.doc.system, "container")) ? "prefilled inventory copy" : `unsupported ${item.doc.type}/token template`) : "missing/wrong licence or rules"}`;
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      continue;
    }
    const key = uuid(item);
    if (seen.has(key)) {
      skipped[`${item.pack}: duplicate document`] =
        (skipped[`${item.pack}: duplicate document`] ?? 0) + 1;
      continue;
    }
    seen.add(key);
    // Readable and stable: Foundry's identifier (kept across its releases), else its document id.
    const slug = slugify(text(at(item.doc.system, "identifier")) || item.doc._id).slice(0, 50);
    selected.push({ ...item, typeId, id: `srd52/${typeId}/${slug}` });
  }
  // Two documents of a type with the same slug both take a suffix from their
  // Foundry uuid, so neither id depends on which one was read first.
  const bySlug = new Map<string, typeof selected>();
  for (const item of selected) bySlug.set(item.id, [...(bySlug.get(item.id) ?? []), item]);
  for (const group of bySlug.values())
    if (group.length > 1)
      for (const item of group)
        item.id = `${item.id}-${createHash("sha256").update(uuid(item)).digest("hex").slice(0, 8)}`;
  const spellLists = readSpellLists(dir, [
    "Bard",
    "Cleric",
    "Druid",
    "Paladin",
    "Ranger",
    "Sorcerer",
    "Warlock",
    "Wizard",
  ]);
  const references = new Map(
    selected.map((item) => [uuid(item), { id: item.id, name: item.doc.name }]),
  );
  const classes = new Map(
    selected
      .filter((i) => i.typeId === "class")
      .map((i) => [text(at(i.doc.system, "identifier")), i.id]),
  );
  const parents = new Map<string, { className: string; subclass?: string; level: number }>();
  for (const item of selected.filter((i) => i.typeId === "class" || i.typeId === "subclass")) {
    const className =
      item.typeId === "class"
        ? item.doc.name
        : selected.find(
            (c) =>
              c.typeId === "class" &&
              at(c.doc.system, "identifier") === at(item.doc.system, "classIdentifier"),
          )?.doc.name;
    if (className)
      for (const grant of grants(item.doc.system))
        parents.set(grant.uuid, {
          className,
          level: grant.level,
          ...(item.typeId === "subclass" ? { subclass: item.doc.name } : {}),
        });
  }
  const classFolders = selected
    .filter((item) => item.typeId === "class")
    .map((item) => ({
      prefix: item.file.slice(0, item.file.lastIndexOf("/") + 1),
      name: item.doc.name,
    }));
  for (const item of selected.filter(
    (item) => item.typeId === "feature" && item.pack === "classes24",
  )) {
    const owner = classFolders.find((folder) => item.file.startsWith(folder.prefix));
    if (owner && !parents.has(uuid(item)))
      parents.set(uuid(item), {
        className: owner.name,
        level: num(at(item.doc.system, "prerequisites.level")),
      });
  }
  const scales = new Map<string, { id: string; name: string }>();
  for (const owner of selected.filter(
    (item) => item.typeId === "class" || item.typeId === "subclass",
  )) {
    for (const scale of array(owner.doc.system?.advancement)
      .map(object)
      .filter((a) => a.type === "ScaleValue")) {
      const identifier = text(at(scale, "configuration.identifier")) || slugify(text(scale.title));
      scales.set(`scale.${text(owner.doc.system?.identifier)}.${identifier}`, {
        id: owner.id,
        name: text(scale.title) || title(identifier),
      });
    }
  }
  const summonProfiles = new Map<string, Data>();
  for (const spell of selected.filter((item) => item.typeId === "spell")) {
    const summon = activities(spell.doc.system).find((activity) => activity.type === "summon");
    if (!summon) continue;
    const targets = [
      ...array(summon.profiles).map((profile) => text(at(profile, "uuid"))),
      ...Array.from(
        description(spell.doc as Data).matchAll(
          /@UUID\[(Compendium\.dnd5e\.actors24\.Actor\.[^\]]+)\]/g,
        ),
        (match) => match[1],
      ),
    ];
    for (const target of targets) summonProfiles.set(target, summon);
  }
  const notes = conversionNotes();
  const entries = selected.flatMap((item) => {
    const doc = item.doc as Data;
    const context: MarkdownContext = {
      doc,
      ...(item.typeId === "monster" ? { actor: doc } : {}),
      references,
      notes,
      summon: summonProfiles.get(uuid(item)),
      scales,
    };
    let body = markdown(
      item.typeId === "monster"
        ? text(at(doc.system, "details.biography.value"))
        : description(doc),
      context,
    );
    if (item.typeId === "monster")
      for (const embedded of array(doc.items).map(object)) {
        if (!licensed({ system: object(embedded.system) }))
          skipped["actors24: embedded item missing/wrong licence or rules"] =
            (skipped["actors24: embedded item missing/wrong licence or rules"] ?? 0) + 1;
      }
    const fields = fieldsFor(item.typeId, context, item, references, parents, classes, body);
    const onLists = item.typeId === "spell" ? spellLists.get(uuid(item)) : undefined;
    if (onLists?.length) fields.classes = [...onLists].sort();
    if (item.typeId === "monster" && !fields.type && text(at(doc.system, "details.type.value")))
      body =
        `Creature type (upstream): ${text(at(doc.system, "details.type.custom")) || text(at(doc.system, "details.type.value"))}\n\n${body}`.trim();
    if (item.typeId === "magic-item" && text(at(doc.system, "rarity")) === "varies")
      body = `Rarity: Varies\n\n${body}`.trim();
    return splitEntry({
      id: item.id,
      typeId: item.typeId,
      name: item.doc.name,
      tags: [],
      visibility: "public",
      fields,
      body,
    });
  });
  const embedPacks = [...notes.embeds].reduce<Record<string, number>>((counts, target) => {
    const pack = target.split(".")[2] || "external";
    counts[pack] = (counts[pack] ?? 0) + 1;
    return counts;
  }, {});
  return {
    format: "ttrpg-source-bundle",
    formatVersion: 1,
    system: library.system,
    source: library.source,
    provenance: {
      upstream: "https://github.com/foundryvtt/dnd5e",
      revision,
      importer: "tools/importers/srd52",
      notes: [
        "Text and stat data only from 2024 packs, with each document and embedded item explicitly marked CC-BY-4.0; rules must be 2024 when present. No artwork, image paths, Foundry automation or endorsement. Uses/recharge are prose only.",
        `Excluded: ${Object.entries(skipped)
          .map(([key, n]) => `${key} (${n})`)
          .join("; ")}.`,
        `Removed ${notes.foundryNotes} Foundry advice/secret sections and artwork credits. Dropped unavailable/unlicensed embeds: ${
          Object.entries(embedPacks)
            .map(([pack, count]) => `${pack} (${count})`)
            .join("; ") || "none"
        }.`,
        "Spell classes come from the class spell-list pages (membership only, no text). Unlicensed content24/tables24 pages cannot supply missing rules, spell-slot tables, species introductions, monster lore or embedded roll tables. Summoned creatures use spell_level, spell_mod, spell_attack and proficiency sheet values for variable rolls; no caster state is inferred. Werewolf’s upstream type is (lycanthrope), outside the select options, so it stays prose.",
        `Unresolved display lookups (retained as labels/prose): ${[...notes.lookups].sort().join("; ") || "none"}.`,
        `Unsupported inline rolls (retained as prose): ${[...notes.rolls].sort().join("; ") || "none"}.`,
      ].join("\n"),
    },
    entries,
  };
};
export const importSrd52 = async (): Promise<SourceBundle> => {
  const source = upstream("dnd5e");
  return importSrd52From(source.dir, source.revision());
};
