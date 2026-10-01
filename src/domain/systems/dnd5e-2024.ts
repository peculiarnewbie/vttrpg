import type { EntryType } from "../compendium";
import type { Licence } from "../licence";

/*
 * Dungeons & Dragons fifth edition (2024 rules), as published in the System
 * Reference Document 5.2. Entry types only describe the shape of the content;
 * the text comes from the SRD 5.2 library (tools/importers/srd52).
 *
 * Fields that people filter by are `filters` (spells by level, school and
 * class; monsters by challenge rating, type and size). Rolls are `actions` rows
 * with notation the dice engine reads — `1d20+6 | 2d10+4` keeps the attack and
 * damage rolls apart. Nothing here decides what a roll means.
 */

export const DND5E_SYSTEM_ID = "dnd5e-2024";
export const SRD52_SOURCE_ID = "srd52";

export const srd52Licence: Licence = {
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/legalcode",
  attribution:
    "This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
  shareAlike: false,
};

const SCHOOLS = [
  "Abjuration",
  "Conjuration",
  "Divination",
  "Enchantment",
  "Evocation",
  "Illusion",
  "Necromancy",
  "Transmutation",
];
const SPELL_CLASSES = [
  "Bard",
  "Cleric",
  "Druid",
  "Paladin",
  "Ranger",
  "Sorcerer",
  "Warlock",
  "Wizard",
];
const CLASSES = [
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];
const CREATURE_TYPES = [
  "Aberration",
  "Beast",
  "Celestial",
  "Construct",
  "Dragon",
  "Elemental",
  "Fey",
  "Fiend",
  "Giant",
  "Humanoid",
  "Monstrosity",
  "Ooze",
  "Plant",
  "Undead",
];
const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"];
const WEAPON_PROPERTIES = [
  "Ammunition",
  "Finesse",
  "Heavy",
  "Light",
  "Loading",
  "Range",
  "Reach",
  "Thrown",
  "Two-Handed",
  "Versatile",
];

export const dnd5eEntryTypes: EntryType[] = [
  {
    id: "spell",
    name: "Spell",
    plural: "Spells",
    fields: [
      // 0 for cantrips.
      { key: "level", label: "Level", kind: "number" },
      { key: "school", label: "School", kind: "select", options: SCHOOLS },
      { key: "classes", label: "Classes", kind: "set", options: SPELL_CLASSES },
      { key: "casting", label: "Casting Time", kind: "text" },
      { key: "range", label: "Range", kind: "text" },
      { key: "components", label: "Components", kind: "set", options: ["V", "S", "M"] },
      { key: "material", label: "Material", kind: "text" },
      { key: "duration", label: "Duration", kind: "text" },
      { key: "properties", label: "Properties", kind: "set", options: ["Concentration", "Ritual"] },
      // e.g. "Fire damage" 8d6, "Healing" 1d8+@spell_mod — clickable.
      { key: "rolls", label: "Rolls", kind: "actions" },
    ],
    filters: [
      { key: "level", kind: "range" },
      { key: "school", kind: "set" },
      { key: "classes", kind: "set" },
      { key: "properties", kind: "set" },
    ],
  },
  {
    id: "monster",
    name: "Monster",
    plural: "Monsters",
    fields: [
      { key: "size", label: "Size", kind: "select", options: SIZES },
      { key: "type", label: "Type", kind: "select", options: CREATURE_TYPES },
      { key: "alignment", label: "Alignment", kind: "text" },
      // Fractions as decimals (1/8 → 0.125) so the range filter works; `cr_label` shows "1/8".
      { key: "cr", label: "Challenge Rating", kind: "number" },
      { key: "cr_label", label: "CR", kind: "text" },
      { key: "xp", label: "XP", kind: "text" },
      { key: "ac", label: "AC", kind: "text" },
      { key: "initiative", label: "Initiative", kind: "text" },
      { key: "hp", label: "HP", kind: "text" },
      { key: "speed", label: "Speed", kind: "text" },
      { key: "str", label: "Str", kind: "number" },
      { key: "dex", label: "Dex", kind: "number" },
      { key: "con", label: "Con", kind: "number" },
      { key: "int", label: "Int", kind: "number" },
      { key: "wis", label: "Wis", kind: "number" },
      { key: "cha", label: "Cha", kind: "number" },
      { key: "saves", label: "Saving Throws", kind: "text" },
      { key: "skills", label: "Skills", kind: "text" },
      { key: "vulnerabilities", label: "Vulnerabilities", kind: "text" },
      { key: "resistances", label: "Resistances", kind: "text" },
      { key: "immunities", label: "Immunities", kind: "text" },
      { key: "senses", label: "Senses", kind: "text" },
      { key: "languages", label: "Languages", kind: "text" },
      { key: "traits", label: "Traits", kind: "actions" },
      { key: "actions", label: "Actions", kind: "actions" },
      { key: "bonus_actions", label: "Bonus Actions", kind: "actions" },
      { key: "reactions", label: "Reactions", kind: "actions" },
      { key: "legendary", label: "Legendary Actions", kind: "actions" },
    ],
    filters: [
      { key: "cr", kind: "range" },
      { key: "type", kind: "set" },
      { key: "size", kind: "set" },
    ],
  },
  {
    id: "weapon",
    name: "Weapon",
    plural: "Weapons",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: ["Simple Melee", "Simple Ranged", "Martial Melee", "Martial Ranged"],
      },
      { key: "damage", label: "Damage", kind: "dice" },
      { key: "damage_type", label: "Damage Type", kind: "text" },
      { key: "properties", label: "Properties", kind: "set", options: WEAPON_PROPERTIES },
      // "Versatile (1d10)", "Range 80/320" — the parenthesised parts of properties.
      { key: "property_notes", label: "Property Notes", kind: "text" },
      { key: "mastery", label: "Mastery", kind: "text" },
      { key: "cost", label: "Cost", kind: "text" },
      { key: "weight", label: "Weight", kind: "text" },
    ],
    filters: [
      { key: "category", kind: "set" },
      { key: "properties", kind: "set" },
    ],
  },
  {
    id: "armor",
    name: "Armor",
    plural: "Armor",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: ["Light", "Medium", "Heavy", "Shield"],
      },
      { key: "ac", label: "Armor Class", kind: "text" },
      { key: "strength", label: "Strength", kind: "text" },
      { key: "stealth", label: "Stealth", kind: "text" },
      { key: "cost", label: "Cost", kind: "text" },
      { key: "weight", label: "Weight", kind: "text" },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
  {
    id: "gear",
    name: "Gear",
    plural: "Gear",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: [
          "Adventuring Gear",
          "Ammunition",
          "Arcane Focus",
          "Druidic Focus",
          "Holy Symbol",
          "Tool",
          "Mount",
          "Vehicle",
          "Pack",
        ],
      },
      { key: "cost", label: "Cost", kind: "text" },
      { key: "weight", label: "Weight", kind: "text" },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
  {
    id: "magic-item",
    name: "Magic Item",
    plural: "Magic Items",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: [
          "Armor",
          "Potion",
          "Ring",
          "Rod",
          "Scroll",
          "Staff",
          "Wand",
          "Weapon",
          "Wondrous Item",
        ],
      },
      { key: "rarity", label: "Rarity", kind: "select", options: RARITIES },
      // "Requires Attunement", "Requires Attunement by a Wizard"; empty when not.
      { key: "attunement", label: "Attunement", kind: "text" },
      { key: "rolls", label: "Rolls", kind: "actions" },
    ],
    filters: [
      { key: "category", kind: "set" },
      { key: "rarity", kind: "set" },
      { key: "attunement", kind: "flag" },
    ],
  },
  {
    id: "class",
    name: "Class",
    plural: "Classes",
    fields: [
      { key: "hit_die", label: "Hit Die", kind: "dice" },
      { key: "primary", label: "Primary Ability", kind: "text" },
      { key: "saves", label: "Saving Throws", kind: "text" },
      { key: "skills", label: "Skills", kind: "text" },
      { key: "weapons", label: "Weapons", kind: "text" },
      { key: "armor", label: "Armor Training", kind: "text" },
      { key: "tools", label: "Tools", kind: "text" },
      { key: "equipment", label: "Starting Equipment", kind: "longtext" },
      // One row per level: proficiency bonus, feature names, and the class's own columns joined in `extra`.
      {
        key: "levels",
        label: "Class Features",
        kind: "progression",
        columns: [
          { key: "proficiency", label: "Prof.", kind: "text" },
          { key: "features", label: "Features", kind: "text" },
          { key: "extra", label: "Other", kind: "text" },
        ],
      },
      {
        key: "features",
        label: "Features",
        kind: "reference",
        ref: { typeIds: ["feature"], multiple: true },
      },
    ],
  },
  {
    id: "subclass",
    name: "Subclass",
    plural: "Subclasses",
    fields: [
      { key: "class", label: "Class", kind: "reference", ref: { typeIds: ["class"] } },
      {
        key: "levels",
        label: "Subclass Features",
        kind: "progression",
        columns: [{ key: "features", label: "Features", kind: "text" }],
      },
      {
        key: "features",
        label: "Features",
        kind: "reference",
        ref: { typeIds: ["feature"], multiple: true },
      },
    ],
  },
  {
    id: "feature",
    name: "Feature",
    plural: "Features",
    fields: [
      { key: "class", label: "Class", kind: "select", options: CLASSES },
      { key: "subclass", label: "Subclass", kind: "text" },
      { key: "level", label: "Level", kind: "number" },
      { key: "rolls", label: "Rolls", kind: "actions" },
    ],
    filters: [
      { key: "class", kind: "set" },
      { key: "level", kind: "range" },
    ],
  },
  {
    id: "species",
    name: "Species",
    plural: "Species",
    fields: [
      { key: "creature_type", label: "Creature Type", kind: "text" },
      { key: "size", label: "Size", kind: "text" },
      { key: "speed", label: "Speed", kind: "text" },
      { key: "traits", label: "Traits", kind: "actions" },
    ],
  },
  {
    id: "background",
    name: "Background",
    plural: "Backgrounds",
    fields: [
      { key: "abilities", label: "Ability Scores", kind: "text" },
      { key: "feat", label: "Feat", kind: "reference", ref: { typeIds: ["feat"] } },
      { key: "skills", label: "Skill Proficiencies", kind: "text" },
      { key: "tool", label: "Tool Proficiency", kind: "text" },
      { key: "equipment", label: "Equipment", kind: "longtext" },
    ],
  },
  {
    id: "feat",
    name: "Feat",
    plural: "Feats",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: ["Origin", "General", "Fighting Style", "Epic Boon"],
      },
      { key: "prerequisite", label: "Prerequisite", kind: "text" },
      { key: "repeatable", label: "Repeatable", kind: "text" },
      { key: "rolls", label: "Rolls", kind: "actions" },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
  {
    // Rules glossary, conditions and other reference text.
    id: "rule",
    name: "Rule",
    plural: "Rules",
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "select",
        options: [
          "Condition",
          "Action",
          "Glossary",
          "Gameplay",
          "Character Creation",
          "Equipment",
          "Magic",
        ],
      },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
];
