import type { EntryType } from "../compendium";
import type { Licence } from "../licence";

/*
 * Ironsworn: Starforged. Entry types for its moves, assets, oracles, sample
 * NPCs and setting truths; the text comes from the Starforged library
 * (tools/importers/starforged, from Datasworn's JSON). Moves describe their
 * rolls in words — the table reads the outcome, the app only rolls.
 */

export const STARFORGED_SYSTEM_ID = "starforged";
export const STARFORGED_SOURCE_ID = "starforged";

export const starforgedLicence: Licence = {
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "This work is based on Ironsworn: Starforged (found at www.ironswornrpg.com), created by Shawn Tomkin, and licensed for our use under the Creative Commons Attribution 4.0 International license (https://creativecommons.org/licenses/by/4.0/). Data converted from Datasworn (https://github.com/rsek/datasworn).",
  shareAlike: false,
};

const MOVE_CATEGORIES = [
  "Session",
  "Adventure",
  "Quest",
  "Connection",
  "Exploration",
  "Combat",
  "Suffer",
  "Recover",
  "Threshold",
  "Legacy",
  "Fate",
  "Scene Challenge",
];
const ASSET_CATEGORIES = [
  "Command Vehicle",
  "Module",
  "Support Vehicle",
  "Path",
  "Companion",
  "Deed",
];

export const starforgedEntryTypes: EntryType[] = [
  {
    id: "move",
    name: "Move",
    plural: "Moves",
    fields: [
      { key: "category", label: "Category", kind: "select", options: MOVE_CATEGORIES },
      { key: "trigger", label: "Trigger", kind: "longtext" },
      // "Action roll +edge or +heart", "Progress roll", "No roll" — what to roll, not what it means.
      { key: "roll", label: "Roll", kind: "text" },
      // A move's own table (Begin a Session's vignette), when it has one.
      { key: "table", label: "Table", kind: "oracle", dice: "1d100" },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
  {
    id: "asset",
    name: "Asset",
    plural: "Assets",
    fields: [
      { key: "category", label: "Category", kind: "select", options: ASSET_CATEGORIES },
      // What the asset asks of you, e.g. "If you wield a heavy ranged personal weapon".
      { key: "requirement", label: "Requirement", kind: "text" },
      // The companion/vehicle's condition meter and its toggles, e.g. "Integrity 5".
      { key: "track", label: "Track", kind: "text" },
      {
        key: "abilities",
        label: "Abilities",
        kind: "list",
        columns: [
          { key: "enabled", label: "On", kind: "check" },
          { key: "text", label: "Ability", kind: "text" },
        ],
      },
    ],
    filters: [{ key: "category", kind: "set" }],
  },
  {
    id: "oracle",
    name: "Oracle",
    plural: "Oracles",
    fields: [
      // The oracle's collection path, e.g. "Planets › Desert World".
      { key: "group", label: "Group", kind: "text" },
      { key: "table", label: "Table", kind: "oracle", dice: "1d100" },
    ],
  },
  {
    id: "npc",
    name: "NPC",
    plural: "NPCs",
    fields: [
      { key: "rank", label: "Rank", kind: "number" },
      { key: "nature", label: "Nature", kind: "text" },
      { key: "features", label: "Features", kind: "longtext" },
      { key: "drives", label: "Drives", kind: "longtext" },
      { key: "tactics", label: "Tactics", kind: "longtext" },
    ],
    filters: [{ key: "rank", kind: "range" }],
  },
  {
    id: "truth",
    name: "Truth",
    plural: "Truths",
    fields: [{ key: "options", label: "Options", kind: "oracle", dice: "1d100" }],
  },
];
