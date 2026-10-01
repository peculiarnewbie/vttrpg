import type { EntryType } from "../compendium";
import type { Licence } from "../licence";

/*
 * Blades in the Dark, from its System Reference Document. The SRD is a
 * toolkit, not the whole game: it has the rules, a pool of special abilities,
 * crew abilities and crew upgrades, but the named playbooks and crews (and the
 * setting) are templates. So `playbook` and `crew` are types a DM fills in;
 * the library (tools/importers/blades) fills the rest.
 */

export const BLADES_SYSTEM_ID = "blades";
export const BLADES_SOURCE_ID = "blades";

export const bladesLicence: Licence = {
  id: "CC-BY-3.0",
  name: "Creative Commons Attribution 3.0 Unported",
  url: "https://creativecommons.org/licenses/by/3.0/",
  attribution:
    "This work is based on Blades in the Dark (found at http://www.bladesinthedark.com/), product of One Seven Design, developed and authored by John Harper, and licensed for our use under the Creative Commons Attribution 3.0 Unported license (http://creativecommons.org/licenses/by/3.0/).",
  shareAlike: false,
};

export const bladesEntryTypes: EntryType[] = [
  {
    id: "ability",
    name: "Special Ability",
    plural: "Special Abilities",
    fields: [],
  },
  {
    id: "crew-ability",
    name: "Crew Ability",
    plural: "Crew Abilities",
    fields: [],
  },
  {
    id: "upgrade",
    name: "Crew Upgrade",
    plural: "Crew Upgrades",
    fields: [
      // Upgrades that cost more than one box ("Hardened" costs three).
      { key: "cost", label: "Boxes", kind: "number" },
    ],
  },
  {
    // Written by the DM: the SRD gives the shape, not the playbooks.
    id: "playbook",
    name: "Playbook",
    plural: "Playbooks",
    fields: [
      { key: "xp", label: "XP Trigger", kind: "longtext" },
      {
        key: "abilities",
        label: "Special Abilities",
        kind: "reference",
        ref: { typeIds: ["ability"], multiple: true },
      },
      {
        key: "friends",
        label: "Friends & Rivals",
        kind: "list",
        columns: [{ key: "name", label: "Name", kind: "text" }],
      },
      {
        key: "items",
        label: "Special Items",
        kind: "list",
        columns: [
          { key: "item", label: "Item", kind: "text" },
          { key: "load", label: "Load", kind: "number" },
        ],
      },
    ],
  },
  {
    id: "crew",
    name: "Crew",
    plural: "Crews",
    fields: [
      { key: "xp", label: "XP Trigger", kind: "longtext" },
      { key: "operations", label: "Favored Operations", kind: "text" },
      {
        key: "abilities",
        label: "Crew Abilities",
        kind: "reference",
        ref: { typeIds: ["crew-ability"], multiple: true },
      },
      {
        key: "upgrades",
        label: "Upgrades",
        kind: "reference",
        ref: { typeIds: ["upgrade"], multiple: true },
      },
    ],
  },
  {
    // Rules sections of the SRD, by chapter.
    id: "rule",
    name: "Rule",
    plural: "Rules",
    fields: [{ key: "chapter", label: "Chapter", kind: "text" }],
  },
];
