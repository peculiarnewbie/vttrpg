import type { EntryType } from "../compendium";
import type { Licence } from "../licence";

/*
 * Cairn, second edition. Entry types for its backgrounds (with their roll
 * tables), bestiary, spellbooks, relics and marketplace; the text comes from
 * the Cairn 2e library (tools/importers/cairn2e). Cairn is share-alike: table
 * overrides of its entries keep the CC BY-SA licence (see licence.ts).
 */

export const CAIRN_SYSTEM_ID = "cairn2e";
export const CAIRN_SOURCE_ID = "cairn2e";

export const cairnLicence: Licence = {
  id: "CC-BY-SA-4.0",
  name: "Creative Commons Attribution-ShareAlike 4.0 International",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution:
    "This work is based on Cairn Second Edition by Yochai Gal (https://cairnrpg.com), licensed under the Creative Commons Attribution-ShareAlike 4.0 International license (https://creativecommons.org/licenses/by-sa/4.0/).",
  shareAlike: true,
};

const MONSTER_GROUPS = [
  "Avian",
  "Beast",
  "Behemoth",
  "Construct",
  "Demon",
  "Extraplanar",
  "Fey",
  "Giant",
  "Goblinoid",
  "Humanoid",
  "Hybrid",
  "Incorporeal",
  "Insectoid",
  "Lizard",
  "Magical",
  "Mythical",
  "Plant",
  "Shape Shifter",
  "Undead",
  "Unusual",
];
// Item tags that change how gear is carried or used.
const ITEM_TAGS = ["bulky", "petty", "blast", "uses"];

export const cairnEntryTypes: EntryType[] = [
  {
    id: "background",
    name: "Background",
    plural: "Backgrounds",
    fields: [
      { key: "names", label: "Names", kind: "text" },
      { key: "gear", label: "Starting Gear", kind: "longtext" },
      // The background's roll tables, each its own rollable entry.
      {
        key: "tables",
        label: "Tables",
        kind: "reference",
        ref: { typeIds: ["table"], multiple: true },
      },
    ],
  },
  {
    id: "table",
    name: "Table",
    plural: "Tables",
    fields: [
      // Where the table comes from: a background, "NPC Tables", "Dungeon Seeds"…
      { key: "group", label: "Group", kind: "text" },
      { key: "table", label: "Table", kind: "oracle", dice: "1d6" },
    ],
  },
  {
    id: "monster",
    name: "Monster",
    plural: "Monsters",
    fields: [
      { key: "group", label: "Group", kind: "select", options: MONSTER_GROUPS },
      { key: "hp", label: "HP", kind: "number" },
      { key: "armor", label: "Armor", kind: "number" },
      { key: "str", label: "STR", kind: "number" },
      { key: "dex", label: "DEX", kind: "number" },
      { key: "wil", label: "WIL", kind: "number" },
      // e.g. bite — 1d8; "or" choices are separate rows.
      { key: "attacks", label: "Attacks", kind: "actions" },
    ],
    filters: [
      { key: "group", kind: "set" },
      { key: "hp", kind: "range" },
    ],
  },
  {
    id: "spellbook",
    name: "Spellbook",
    plural: "Spellbooks",
    fields: [],
  },
  {
    id: "relic",
    name: "Relic",
    plural: "Relics",
    fields: [
      // e.g. "3 charges"; the recharge condition stays in the text.
      { key: "charges", label: "Charges", kind: "text" },
    ],
  },
  {
    id: "item",
    name: "Item",
    plural: "Items",
    fields: [
      { key: "category", label: "Category", kind: "text" },
      { key: "cost", label: "Cost", kind: "text" },
      { key: "damage", label: "Damage", kind: "dice" },
      { key: "armor", label: "Armor", kind: "number" },
      // Bulky items take two slots on a Cairn sheet (`slotSize`).
      { key: "slots", label: "Slots", kind: "number" },
      { key: "properties", label: "Properties", kind: "set", options: ITEM_TAGS },
      { key: "uses", label: "Uses", kind: "text" },
    ],
    filters: [
      { key: "properties", kind: "set" },
      { key: "slots", kind: "range" },
    ],
  },
  {
    // Player's guide and Warden's guide chapters, by section.
    id: "rule",
    name: "Rule",
    plural: "Rules",
    fields: [{ key: "chapter", label: "Chapter", kind: "text" }],
  },
];
