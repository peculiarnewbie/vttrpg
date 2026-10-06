import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * A fifth-edition (2024 rules) character on generic blocks. Ability modifiers, proficiency,
 * saves and skills are derived values the sheet shows and rolls use; the
 * player marks proficiency as pips (1 proficient, 2 expertise for skills).
 * Nothing is written back: hit points, slots and uses are marked by hand.
 */

const mods = [
  { key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" },
  { key: "dex_mod", label: "DEX mod", expr: "floor((@dex - 10) / 2)" },
  { key: "con_mod", label: "CON mod", expr: "floor((@con - 10) / 2)" },
  { key: "int_mod", label: "INT mod", expr: "floor((@int - 10) / 2)" },
  { key: "wis_mod", label: "WIS mod", expr: "floor((@wis - 10) / 2)" },
  { key: "cha_mod", label: "CHA mod", expr: "floor((@cha - 10) / 2)" },
];
const saves = [
  { key: "str_save", label: "Strength save", expr: "@str_mod + @str_save_prof * @prof" },
  { key: "dex_save", label: "Dexterity save", expr: "@dex_mod + @dex_save_prof * @prof" },
  { key: "con_save", label: "Constitution save", expr: "@con_mod + @con_save_prof * @prof" },
  { key: "int_save", label: "Intelligence save", expr: "@int_mod + @int_save_prof * @prof" },
  { key: "wis_save", label: "Wisdom save", expr: "@wis_mod + @wis_save_prof * @prof" },
  { key: "cha_save", label: "Charisma save", expr: "@cha_mod + @cha_save_prof * @prof" },
];
const skills = [
  { key: "acrobatics_bonus", label: "Acrobatics", expr: "@dex_mod + @acrobatics * @prof" },
  {
    key: "animal_handling_bonus",
    label: "Animal Handling",
    expr: "@wis_mod + @animal_handling * @prof",
  },
  { key: "arcana_bonus", label: "Arcana", expr: "@int_mod + @arcana * @prof" },
  { key: "athletics_bonus", label: "Athletics", expr: "@str_mod + @athletics * @prof" },
  { key: "deception_bonus", label: "Deception", expr: "@cha_mod + @deception * @prof" },
  { key: "history_bonus", label: "History", expr: "@int_mod + @history * @prof" },
  { key: "insight_bonus", label: "Insight", expr: "@wis_mod + @insight * @prof" },
  { key: "intimidation_bonus", label: "Intimidation", expr: "@cha_mod + @intimidation * @prof" },
  { key: "investigation_bonus", label: "Investigation", expr: "@int_mod + @investigation * @prof" },
  { key: "medicine_bonus", label: "Medicine", expr: "@wis_mod + @medicine * @prof" },
  { key: "nature_bonus", label: "Nature", expr: "@int_mod + @nature * @prof" },
  { key: "perception_bonus", label: "Perception", expr: "@wis_mod + @perception * @prof" },
  { key: "performance_bonus", label: "Performance", expr: "@cha_mod + @performance * @prof" },
  { key: "persuasion_bonus", label: "Persuasion", expr: "@cha_mod + @persuasion * @prof" },
  { key: "religion_bonus", label: "Religion", expr: "@int_mod + @religion * @prof" },
  {
    key: "sleight_of_hand_bonus",
    label: "Sleight of Hand",
    expr: "@dex_mod + @sleight_of_hand * @prof",
  },
  { key: "stealth_bonus", label: "Stealth", expr: "@dex_mod + @stealth * @prof" },
  { key: "survival_bonus", label: "Survival", expr: "@wis_mod + @survival * @prof" },
];

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
/** Point-buy cost of a score: 8 is free, each point to 13 costs 1, 14 and 15 cost 2 more each. */
const pointCost = (key: string) => `max(0, @${key} - 8) + max(0, @${key} - 13)`;

/*
 * Step by step through the same values the sheet edits: pick entries, place
 * or type numbers, roll into chat. Rolls never land on the sheet and nothing
 * is checked — counts and the point-buy tally are hints. Choices limited to
 * an earlier pick (a class's features, a background's feat) read that entry's
 * reference field; readouts read its other fields (`@class.hit_die`).
 */
export const dnd5eCharacterBuilder: SheetBuilder = {
  steps: [
    {
      id: "class",
      title: "Class",
      hint: "Pick a class and write your level in; the sheet shows what each level grants.",
      parts: [
        { type: "choose", key: "class" },
        { type: "choose", key: "features", from: { entry: "class", field: "features" } },
        { type: "blocks", blocks: ["level", "class-progression"] },
      ],
    },
    {
      id: "species",
      title: "Species",
      hint: "Pick a species.",
      parts: [{ type: "choose", key: "species" }],
    },
    {
      id: "background",
      title: "Background",
      hint: "Pick a background, then add the feat it grants below.",
      parts: [
        { type: "choose", key: "background" },
        { type: "choose", key: "feats", from: { entry: "background", field: "feat" }, pick: 1 },
      ],
    },
    {
      id: "abilities",
      title: "Ability Scores",
      hint: "Use the way your table agrees on: place the standard array, buy scores with 27 points (8 to 15 each), or roll 4d6 six times and type the results in.",
      parts: [
        {
          type: "show",
          items: [{ label: "Background suggests", expr: "@background.abilities" }],
          when: "@background.abilities",
        },
        {
          type: "assign",
          label: "Standard array",
          values: [15, 14, 13, 12, 10, 8],
          targets: ABILITIES,
        },
        {
          type: "budget",
          label: "Point buy",
          spent: ABILITIES.map(pointCost).join(" + "),
          total: "27",
          items: ABILITIES.map((key) => ({ key, cap: 15 })),
        },
        {
          type: "rolls",
          items: [
            {
              label: "Ability scores",
              dice: "4d6kh3",
              times: 6,
              note: "One roll per score; place them as you like.",
            },
          ],
        },
        { type: "blocks", blocks: ["abilities", "modifiers"] },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      hint: "Tick the saves and skills your class and background grant; note the rest under proficiencies.",
      parts: [
        {
          type: "show",
          items: [
            { label: "Class saves", expr: "@class.saves" },
            { label: "Class skills", expr: "@class.skills" },
            { label: "Background skills", expr: "@background.skills" },
            { label: "Background tool", expr: "@background.tool" },
          ],
          when: "@class or @background",
        },
        { type: "blocks", blocks: ["save-proficiency", "skill-proficiency", "proficiencies"] },
      ],
    },
    {
      id: "defenses",
      title: "Hit Points & Defenses",
      hint: "Hit points come from your class's hit die and Constitution; write your AC from your armor.",
      parts: [
        {
          type: "show",
          items: [
            { label: "Hit die", expr: "@class.hit_die" },
            { label: "Hit point maximum", expr: "@hp_max" },
            { label: "AC without armor", expr: "10 + @dex_mod" },
            { label: "Initiative", expr: "@initiative" },
            { label: "Passive Perception", expr: "@passive_perception" },
          ],
        },
        { type: "blocks", blocks: ["health", "combat"] },
      ],
    },
    {
      id: "equipment",
      title: "Equipment",
      hint: "Add weapons, armor and gear from the compendium; write attack bonuses and quantities by hand.",
      parts: [
        { type: "choose", key: "weapons" },
        { type: "choose", key: "armor" },
        { type: "choose", key: "gear" },
      ],
    },
    {
      id: "spells",
      title: "Spells",
      hint: "Write your spellcasting ability modifier in, then add the spells you know and tick the ones you have prepared.",
      parts: [
        { type: "blocks", blocks: ["casting"] },
        {
          type: "show",
          items: [
            { label: "Spell attack", expr: "@spell_attack" },
            { label: "Spell save DC", expr: "@spell_dc" },
          ],
        },
        { type: "choose", key: "spells" },
      ],
    },
    {
      id: "review",
      title: "Review",
      hint: "Anything still blank is listed here. Nothing is checked; fill in what your table uses.",
      parts: [{ type: "review" }],
    },
  ],
};

export const dnd5eCharacter: SheetLayout = {
  system: "Fifth Edition (SRD 5.2)",
  name: "Character",
  builder: dnd5eCharacterBuilder,
  derived: [
    { key: "prof", label: "Proficiency", expr: "ceil(@level / 4) + 1" },
    ...mods,
    ...saves,
    ...skills,
    { key: "initiative", label: "Initiative", expr: "@dex_mod" },
    { key: "passive_perception", label: "Passive Perception", expr: "10 + @perception_bonus" },
    { key: "spell_attack", label: "Spell attack", expr: "@prof + @spell_mod" },
    { key: "spell_dc", label: "Spell save DC", expr: "8 + @prof + @spell_mod" },
    // The largest face of the chosen class's hit die ("1d10" → 10); 0 before a class is chosen.
    {
      key: "hit_die_size",
      label: "Hit die size",
      expr: 'if(@class.hit_die == "1d12", 12, if(@class.hit_die == "1d10", 10, if(@class.hit_die == "1d8", 8, if(@class.hit_die == "1d6", 6, 0))))',
    },
    // The full die at level 1, then its fixed average per level, plus CON each level.
    {
      key: "hp_max",
      label: "Hit point maximum",
      expr: "if(@hit_die_size, @hit_die_size + @con_mod + (max(@level, 1) - 1) * (@hit_die_size / 2 + 1 + @con_mod), 0)",
    },
  ],
  pages: [
    {
      id: "character",
      title: "Character",
      blocks: [
        {
          id: "class",
          type: "entry",
          key: "class",
          entryType: "class",
          label: "Class",
          variant: "line",
          span: 3,
        },
        {
          id: "species",
          type: "entry",
          key: "species",
          entryType: "species",
          label: "Species",
          variant: "line",
          span: 3,
        },
        {
          id: "background",
          type: "entry",
          key: "background",
          entryType: "background",
          label: "Background",
          variant: "line",
          span: 3,
        },
        {
          id: "level",
          type: "stats",
          span: 3,
          items: [
            { key: "level", label: "Level" },
            { key: "prof", label: "Prof." },
          ],
        },
        {
          id: "abilities",
          type: "stats",
          variant: "boxes",
          items: [
            { key: "str", label: "STR" },
            { key: "dex", label: "DEX" },
            { key: "con", label: "CON" },
            { key: "int", label: "INT" },
            { key: "wis", label: "WIS" },
            { key: "cha", label: "CHA" },
          ],
        },
        {
          id: "modifiers",
          type: "stats",
          items: [
            { key: "str_mod", label: "STR mod", roll: "1d20 + @str_mod" },
            { key: "dex_mod", label: "DEX mod", roll: "1d20 + @dex_mod" },
            { key: "con_mod", label: "CON mod", roll: "1d20 + @con_mod" },
            { key: "int_mod", label: "INT mod", roll: "1d20 + @int_mod" },
            { key: "wis_mod", label: "WIS mod", roll: "1d20 + @wis_mod" },
            { key: "cha_mod", label: "CHA mod", roll: "1d20 + @cha_mod" },
          ],
        },
        {
          id: "health",
          type: "trackers",
          span: 3,
          items: [
            // From the class's hit die once one is chosen; 10 until then. Edit sets your own.
            {
              key: "hp",
              label: "Hit Points",
              min: 0,
              max: 999,
              maxFrom: "if(@hp_max > 0, @hp_max, 10)",
            },
            { key: "temp_hp", label: "Temp HP", min: 0, max: 30, start: 0 },
            {
              key: "hit_dice",
              label: "Hit Dice",
              min: 0,
              max: 20,
              maxFrom: "max(@level, 1)",
              roll: "@class.hit_die + @con_mod",
            },
          ],
        },
        {
          id: "combat",
          type: "stats",
          span: 3,
          items: [
            { key: "ac", label: "AC" },
            { key: "initiative", label: "Initiative", roll: "1d20 + @initiative" },
            { key: "speed", label: "Speed" },
            { key: "passive_perception", label: "Passive Perc." },
          ],
        },
        {
          id: "death",
          type: "trackers",
          variant: "boxes",
          items: [
            { key: "death_successes", label: "Death save successes", min: 0, max: 3, start: 0 },
            { key: "death_failures", label: "Death save failures", min: 0, max: 3, start: 0 },
          ],
        },
        {
          id: "weapons",
          type: "list",
          key: "weapons",
          title: "Weapons",
          source: { entryType: "weapon" },
          roll: "1d20 + @row.attack",
          columns: [
            { key: "name", label: "Weapon", kind: "text" },
            { key: "attack", label: "Attack", kind: "number" },
            { key: "damage", label: "Damage", kind: "dice" },
            { key: "damage_type", label: "Type", kind: "text" },
            { key: "mastery", label: "Mastery", kind: "text" },
          ],
        },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "d20", dice: "1d20" },
            { label: "Advantage", dice: "1d20adv" },
            { label: "Disadvantage", dice: "1d20dis" },
          ],
        },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      blocks: [
        {
          id: "saves",
          type: "stats",
          variant: "list",
          span: 2,
          items: [
            { key: "str_save", label: "Strength", roll: "1d20 + @str_save" },
            { key: "dex_save", label: "Dexterity", roll: "1d20 + @dex_save" },
            { key: "con_save", label: "Constitution", roll: "1d20 + @con_save" },
            { key: "int_save", label: "Intelligence", roll: "1d20 + @int_save" },
            { key: "wis_save", label: "Wisdom", roll: "1d20 + @wis_save" },
            { key: "cha_save", label: "Charisma", roll: "1d20 + @cha_save" },
          ],
        },
        {
          id: "skill-totals",
          type: "stats",
          variant: "list",
          span: 4,
          items: [
            { key: "acrobatics_bonus", label: "Acrobatics", roll: "1d20 + @acrobatics_bonus" },
            {
              key: "animal_handling_bonus",
              label: "Animal Handling",
              roll: "1d20 + @animal_handling_bonus",
            },
            { key: "arcana_bonus", label: "Arcana", roll: "1d20 + @arcana_bonus" },
            { key: "athletics_bonus", label: "Athletics", roll: "1d20 + @athletics_bonus" },
            { key: "deception_bonus", label: "Deception", roll: "1d20 + @deception_bonus" },
            { key: "history_bonus", label: "History", roll: "1d20 + @history_bonus" },
            { key: "insight_bonus", label: "Insight", roll: "1d20 + @insight_bonus" },
            {
              key: "intimidation_bonus",
              label: "Intimidation",
              roll: "1d20 + @intimidation_bonus",
            },
            {
              key: "investigation_bonus",
              label: "Investigation",
              roll: "1d20 + @investigation_bonus",
            },
            { key: "medicine_bonus", label: "Medicine", roll: "1d20 + @medicine_bonus" },
            { key: "nature_bonus", label: "Nature", roll: "1d20 + @nature_bonus" },
            { key: "perception_bonus", label: "Perception", roll: "1d20 + @perception_bonus" },
            { key: "performance_bonus", label: "Performance", roll: "1d20 + @performance_bonus" },
            { key: "persuasion_bonus", label: "Persuasion", roll: "1d20 + @persuasion_bonus" },
            { key: "religion_bonus", label: "Religion", roll: "1d20 + @religion_bonus" },
            {
              key: "sleight_of_hand_bonus",
              label: "Sleight of Hand",
              roll: "1d20 + @sleight_of_hand_bonus",
            },
            { key: "stealth_bonus", label: "Stealth", roll: "1d20 + @stealth_bonus" },
            { key: "survival_bonus", label: "Survival", roll: "1d20 + @survival_bonus" },
          ],
        },
        {
          id: "save-proficiency",
          type: "trackers",
          span: 2,
          items: [
            { key: "str_save_prof", label: "Strength save", min: 0, max: 1, start: 0 },
            { key: "dex_save_prof", label: "Dexterity save", min: 0, max: 1, start: 0 },
            { key: "con_save_prof", label: "Constitution save", min: 0, max: 1, start: 0 },
            { key: "int_save_prof", label: "Intelligence save", min: 0, max: 1, start: 0 },
            { key: "wis_save_prof", label: "Wisdom save", min: 0, max: 1, start: 0 },
            { key: "cha_save_prof", label: "Charisma save", min: 0, max: 1, start: 0 },
          ],
        },
        {
          id: "skill-proficiency",
          type: "trackers",
          span: 4,
          items: [
            { key: "acrobatics", label: "Acrobatics", min: 0, max: 2, start: 0 },
            { key: "animal_handling", label: "Animal Handling", min: 0, max: 2, start: 0 },
            { key: "arcana", label: "Arcana", min: 0, max: 2, start: 0 },
            { key: "athletics", label: "Athletics", min: 0, max: 2, start: 0 },
            { key: "deception", label: "Deception", min: 0, max: 2, start: 0 },
            { key: "history", label: "History", min: 0, max: 2, start: 0 },
            { key: "insight", label: "Insight", min: 0, max: 2, start: 0 },
            { key: "intimidation", label: "Intimidation", min: 0, max: 2, start: 0 },
            { key: "investigation", label: "Investigation", min: 0, max: 2, start: 0 },
            { key: "medicine", label: "Medicine", min: 0, max: 2, start: 0 },
            { key: "nature", label: "Nature", min: 0, max: 2, start: 0 },
            { key: "perception", label: "Perception", min: 0, max: 2, start: 0 },
            { key: "performance", label: "Performance", min: 0, max: 2, start: 0 },
            { key: "persuasion", label: "Persuasion", min: 0, max: 2, start: 0 },
            { key: "religion", label: "Religion", min: 0, max: 2, start: 0 },
            { key: "sleight_of_hand", label: "Sleight of Hand", min: 0, max: 2, start: 0 },
            { key: "stealth", label: "Stealth", min: 0, max: 2, start: 0 },
            { key: "survival", label: "Survival", min: 0, max: 2, start: 0 },
          ],
        },
        {
          id: "proficiencies",
          type: "text",
          key: "proficiencies",
          label: "Other proficiencies & languages",
        },
      ],
    },
    {
      id: "spells",
      title: "Spells",
      blocks: [
        {
          id: "casting",
          type: "stats",
          items: [
            { key: "spell_mod", label: "Spell ability mod" },
            { key: "spell_attack", label: "Spell attack", roll: "1d20 + @spell_attack" },
            { key: "spell_dc", label: "Save DC" },
          ],
        },
        {
          id: "slots",
          type: "trackers",
          variant: "boxes",
          items: [
            { key: "slots_1", label: "1st", min: 0, max: 4, start: 0 },
            { key: "slots_2", label: "2nd", min: 0, max: 3, start: 0 },
            { key: "slots_3", label: "3rd", min: 0, max: 3, start: 0 },
            { key: "slots_4", label: "4th", min: 0, max: 3, start: 0 },
            { key: "slots_5", label: "5th", min: 0, max: 3, start: 0 },
            { key: "slots_6", label: "6th", min: 0, max: 2, start: 0 },
            { key: "slots_7", label: "7th", min: 0, max: 2, start: 0 },
            { key: "slots_8", label: "8th", min: 0, max: 1, start: 0 },
            { key: "slots_9", label: "9th", min: 0, max: 1, start: 0 },
          ],
        },
        {
          id: "spell-list",
          type: "list",
          key: "spells",
          title: "Spells",
          source: { entryType: "spell" },
          columns: [
            { key: "prepared", label: "Prep.", kind: "check" },
            { key: "name", label: "Spell", kind: "text" },
            { key: "level", label: "Lvl", kind: "number" },
            { key: "casting", label: "Casting", kind: "text" },
            { key: "range", label: "Range", kind: "text" },
          ],
        },
      ],
    },
    {
      id: "features",
      title: "Features & Gear",
      blocks: [
        {
          id: "class-progression",
          type: "entry",
          key: "class",
          entryType: "class",
          variant: "progression",
          progression: { field: "levels", level: "level" },
        },
        {
          id: "feature-list",
          type: "list",
          key: "features",
          title: "Features",
          source: { entryType: "feature" },
          columns: [
            { key: "name", label: "Feature", kind: "text" },
            { key: "level", label: "Lvl", kind: "number" },
          ],
        },
        {
          id: "feat-list",
          type: "list",
          key: "feats",
          title: "Feats",
          source: { entryType: "feat" },
          columns: [
            { key: "name", label: "Feat", kind: "text" },
            { key: "category", label: "Category", kind: "text" },
          ],
        },
        {
          id: "gear",
          type: "list",
          key: "gear",
          title: "Equipment",
          source: { entryType: "gear" },
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "qty", label: "Qty", kind: "number" },
            { key: "weight", label: "Weight", kind: "text" },
          ],
        },
        {
          id: "armor",
          type: "list",
          key: "armor",
          title: "Armor",
          source: { entryType: "armor" },
          columns: [
            { key: "name", label: "Armor", kind: "text" },
            { key: "ac", label: "AC", kind: "text" },
            { key: "weight", label: "Weight", kind: "text" },
          ],
        },
        {
          id: "magic-items",
          type: "list",
          key: "magic_items",
          title: "Magic Items",
          source: { entryType: "magic-item" },
          columns: [
            { key: "attuned", label: "Att.", kind: "check" },
            { key: "name", label: "Item", kind: "text" },
            { key: "rarity", label: "Rarity", kind: "text" },
          ],
        },
        {
          id: "coins",
          type: "stats",
          items: [
            { key: "cp", label: "CP" },
            { key: "sp", label: "SP" },
            { key: "ep", label: "EP" },
            { key: "gp", label: "GP" },
            { key: "pp", label: "PP" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};
