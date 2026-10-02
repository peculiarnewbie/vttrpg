import type { EntryType } from "../compendium";

/*
 * Stonetop (Jeremy Strandberg, Lampblack & Brimstone). Shapes only for now —
 * sheets and entry types, no rules text. Its text is reported to be CC BY-SA
 * 4.0; once that's confirmed from the book, a library can fill these types the
 * way the Cairn one does.
 */

export const STONETOP_SYSTEM_ID = "stonetop";

const STATS = ["STR", "DEX", "INT", "WIS", "CON", "CHA"];

export const stonetopEntryTypes: EntryType[] = [
  {
    id: "playbook",
    name: "Playbook",
    plural: "Playbooks",
    fields: [
      { key: "hp", label: "Base HP", kind: "number" },
      { key: "damage", label: "Damage", kind: "dice" },
    ],
  },
  {
    id: "move",
    name: "Move",
    plural: "Moves",
    fields: [
      // Basic and steading moves leave it empty.
      { key: "playbook", label: "Playbook", kind: "tags" },
      { key: "stat", label: "Rolls", kind: "select", options: STATS },
    ],
    filters: [
      { key: "playbook", kind: "set" },
      { key: "stat", kind: "set" },
    ],
  },
  {
    id: "arcanum",
    name: "Arcanum",
    plural: "Arcana",
    fields: [{ key: "kind", label: "Kind", kind: "select", options: ["Minor", "Major"] }],
    filters: [{ key: "kind", kind: "set" }],
  },
  {
    id: "improvement",
    name: "Steading improvement",
    plural: "Steading improvements",
    fields: [{ key: "requirements", label: "Requirements", kind: "longtext" }],
  },
  {
    id: "npc",
    name: "NPC or monster",
    plural: "NPCs and monsters",
    fields: [
      { key: "hp", label: "HP", kind: "number" },
      { key: "armor", label: "Armor", kind: "number" },
      { key: "damage", label: "Damage", kind: "dice" },
      { key: "tags", label: "Tags", kind: "tags" },
      { key: "instinct", label: "Instinct", kind: "text" },
    ],
  },
];
