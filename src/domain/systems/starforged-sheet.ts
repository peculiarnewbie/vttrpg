import type { SheetLayout } from "../sheet-layout";

/*
 * Starforged on generic blocks. An action roll is the action die plus a stat
 * against two challenge dice, kept as separate groups (`|`) so nobody has to
 * untangle a sum; the table reads strong/weak hits and misses itself. Vows and
 * legacies are progress tracks (10 boxes × 4 ticks).
 */

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
