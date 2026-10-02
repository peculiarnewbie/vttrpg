import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * Starforged on generic blocks. An action roll is the action die plus a stat
 * against two challenge dice, kept as separate groups (`|`) so nobody has to
 * untangle a sum; the table reads strong/weak hits and misses itself. Vows and
 * legacies are progress tracks (10 boxes × 4 ticks).
 *
 * The builder walks the same sheet: assets, then stats, then a vow and a
 * name, then a last look. Rolls stay rolls — they go to chat, never the sheet.
 */

/** Library oracles for names (tools/importers/starforged); skipped until the library is here. */
const GIVEN_NAME = "starforged/oracle/starforged-oracles-characters-name-given-addad48f715a";
const FAMILY_NAME = "starforged/oracle/starforged-oracles-characters-name-family-name-c5565ef8f0c6";

export const starforgedCharacterBuilder: SheetBuilder = {
  steps: [
    {
      id: "paths",
      title: "Paths & assets",
      hint: "Choose three assets and add them to the list. You can change them later on the sheet.",
      parts: [
        { type: "choose", key: "assets", pick: 3 },
        { type: "blocks", blocks: ["asset-list"] },
      ],
    },
    {
      id: "stats",
      title: "Stats",
      hint: "Give the five stats 3, 2, 2, 1 and 1, highest where it fits best. Type each number in.",
      parts: [{ type: "blocks", blocks: ["stats"] }],
    },
    {
      id: "vow",
      title: "Background vow & name",
      hint: "Roll for a name if you like, then write it in. Add your starting vow with its rank.",
      parts: [
        { type: "tables", entries: [GIVEN_NAME, FAMILY_NAME] },
        { type: "blocks", blocks: ["who", "vows"] },
      ],
    },
    {
      id: "review",
      title: "Review",
      hint: "Look over the meters, impacts and legacies, and adjust anything. Nothing here is locked in.",
      parts: [{ type: "blocks", blocks: ["meters", "impacts", "legacies"] }],
    },
  ],
};

export const starforgedStarshipBuilder: SheetBuilder = {
  steps: [
    {
      id: "ship",
      title: "Ship",
      hint: "Name the ship and add its modules below.",
      parts: [
        { type: "blocks", blocks: ["name"] },
        { type: "choose", key: "modules" },
      ],
    },
    {
      id: "condition",
      title: "Condition",
      hint: "Note the ship's integrity and any impacts.",
      parts: [{ type: "blocks", blocks: ["integrity", "impacts"] }],
    },
  ],
};

const stat = (key: string, label: string) => ({
  key,
  label,
  roll: `1d6 + @${key} | 1d10 | 1d10`,
});
const IMPACTS = [
  "Wounded",
  "Shaken",
  "Unprepared",
  "Harmed",
  "Traumatized",
  "Doomed",
  "Tormented",
  "Indebted",
];
const RANKS = ["Troublesome", "Dangerous", "Formidable", "Extreme", "Epic"];

export const starforgedCharacter: SheetLayout = {
  system: "Ironsworn: Starforged",
  name: "Character",
  builder: starforgedCharacterBuilder,
  pages: [
    {
      id: "character",
      title: "Character",
      blocks: [
        {
          id: "who",
          type: "fields",
          variant: "inline",
          columns: 2,
          items: [
            { key: "callsign", label: "Callsign" },
            { key: "pronouns", label: "Pronouns" },
            { key: "characteristics", label: "Characteristics" },
            { key: "location", label: "Location" },
          ],
        },
        {
          id: "stats",
          type: "stats",
          variant: "boxes",
          items: [
            stat("edge", "Edge"),
            stat("heart", "Heart"),
            stat("iron", "Iron"),
            stat("shadow", "Shadow"),
            stat("wits", "Wits"),
          ],
        },
        {
          id: "meters",
          type: "trackers",
          items: [
            { key: "health", label: "Health", min: 0, max: 5, roll: "1d6 + @health | 1d10 | 1d10" },
            { key: "spirit", label: "Spirit", min: 0, max: 5, roll: "1d6 + @spirit | 1d10 | 1d10" },
            { key: "supply", label: "Supply", min: 0, max: 5, roll: "1d6 + @supply | 1d10 | 1d10" },
            { key: "momentum", label: "Momentum", min: -6, max: 10, start: 2 },
          ],
        },
        {
          id: "impacts",
          type: "checks",
          key: "impacts",
          label: "Impacts",
          variant: "tags",
          options: IMPACTS,
        },
        {
          id: "vows",
          type: "list",
          key: "vows",
          title: "Vows",
          columns: [
            { key: "name", label: "Vow", kind: "text" },
            { key: "rank", label: "Rank", kind: "select", options: RANKS },
            { key: "progress", label: "Progress", kind: "progress" },
          ],
        },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "Progress roll", dice: "1d10 | 1d10" },
            { label: "Ask the Oracle", dice: "1d100" },
          ],
        },
      ],
    },
    {
      id: "assets",
      title: "Assets & Legacy",
      blocks: [
        {
          id: "asset-list",
          type: "list",
          key: "assets",
          title: "Assets",
          variant: "cards",
          source: { entryType: "asset" },
          columns: [
            { key: "name", label: "Asset", kind: "text" },
            { key: "category", label: "Category", kind: "text" },
            { key: "requirement", label: "Requires", kind: "text" },
            { key: "track", label: "Track", kind: "text" },
          ],
        },
        {
          id: "legacies",
          type: "trackers",
          items: [
            { key: "quests", label: "Quests", min: 0, max: 40, start: 0, display: "progress" },
            { key: "bonds", label: "Bonds", min: 0, max: 40, start: 0, display: "progress" },
            {
              key: "discoveries",
              label: "Discoveries",
              min: 0,
              max: 40,
              start: 0,
              display: "progress",
            },
          ],
        },
        {
          id: "connections",
          type: "list",
          key: "connections",
          title: "Connections",
          columns: [
            { key: "name", label: "Connection", kind: "text" },
            { key: "role", label: "Role", kind: "text" },
            { key: "rank", label: "Rank", kind: "select", options: RANKS },
            { key: "progress", label: "Bond", kind: "progress" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};

export const starforgedStarship: SheetLayout = {
  subject: "shared",
  system: "Ironsworn: Starforged",
  name: "Starship",
  builder: starforgedStarshipBuilder,
  pages: [
    {
      id: "ship",
      title: "Starship",
      blocks: [
        {
          id: "name",
          type: "fields",
          columns: 2,
          items: [
            { key: "type", label: "Type" },
            { key: "history", label: "History" },
          ],
        },
        {
          id: "integrity",
          type: "trackers",
          items: [
            {
              key: "integrity",
              label: "Integrity",
              min: 0,
              max: 5,
              roll: "1d6 + @integrity | 1d10 | 1d10",
            },
          ],
        },
        {
          id: "impacts",
          type: "checks",
          key: "impacts",
          label: "Impacts",
          variant: "tags",
          options: ["Battered", "Cursed"],
        },
        {
          id: "modules",
          type: "list",
          key: "modules",
          title: "Command vehicle & modules",
          variant: "cards",
          source: { entryType: "asset" },
          columns: [
            { key: "name", label: "Asset", kind: "text" },
            { key: "category", label: "Category", kind: "text" },
          ],
        },
        {
          id: "expeditions",
          type: "list",
          key: "expeditions",
          title: "Expeditions",
          columns: [
            { key: "name", label: "Expedition", kind: "text" },
            { key: "rank", label: "Rank", kind: "select", options: RANKS },
            { key: "progress", label: "Progress", kind: "progress" },
          ],
        },
      ],
    },
  ],
};
