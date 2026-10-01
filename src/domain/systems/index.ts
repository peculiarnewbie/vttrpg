import type { SourceInput, SystemInput } from "../corpus-rpc";
import { BLADES_SOURCE_ID, BLADES_SYSTEM_ID, bladesEntryTypes, bladesLicence } from "./blades";
import { CAIRN_SOURCE_ID, CAIRN_SYSTEM_ID, cairnEntryTypes, cairnLicence } from "./cairn2e";
import { DND5E_SYSTEM_ID, SRD52_SOURCE_ID, dnd5eEntryTypes, srd52Licence } from "./dnd5e-2024";
import {
  STARFORGED_SOURCE_ID,
  STARFORGED_SYSTEM_ID,
  starforgedEntryTypes,
  starforgedLicence,
} from "./starforged";

/*
 * The systems the app ships first-party: each a system definition (entry
 * types and sheet layouts — shapes, no rules text) and the open library its
 * text is published as. Importers target these ids and field keys.
 */

export type FirstPartySystem = { system: SystemInput; source: SourceInput };

export const firstPartySystems: readonly FirstPartySystem[] = [
  {
    system: {
      id: DND5E_SYSTEM_ID,
      name: "D&D 5e (2024)",
      description: "Fifth edition with the 2024 rules, from the SRD 5.2.",
      entryTypes: dnd5eEntryTypes,
      layouts: [],
    },
    source: {
      id: SRD52_SOURCE_ID,
      name: "System Reference Document 5.2",
      systemId: DND5E_SYSTEM_ID,
      licence: srd52Licence,
      visibility: "public",
    },
  },
  {
    system: {
      id: STARFORGED_SYSTEM_ID,
      name: "Ironsworn: Starforged",
      description: "Solo, co-op and guided science-fiction adventure.",
      entryTypes: starforgedEntryTypes,
      layouts: [],
    },
    source: {
      id: STARFORGED_SOURCE_ID,
      name: "Ironsworn: Starforged",
      systemId: STARFORGED_SYSTEM_ID,
      licence: starforgedLicence,
      visibility: "public",
    },
  },
  {
    system: {
      id: CAIRN_SYSTEM_ID,
      name: "Cairn (2nd edition)",
      description: "Adventure game about exploring a dark and mysterious Wood.",
      entryTypes: cairnEntryTypes,
      layouts: [],
    },
    source: {
      id: CAIRN_SOURCE_ID,
      name: "Cairn Second Edition",
      systemId: CAIRN_SYSTEM_ID,
      licence: cairnLicence,
      visibility: "public",
    },
  },
  {
    system: {
      id: BLADES_SYSTEM_ID,
      name: "Blades in the Dark",
      description: "Daring scoundrels building a criminal enterprise.",
      entryTypes: bladesEntryTypes,
      layouts: [],
    },
    source: {
      id: BLADES_SOURCE_ID,
      name: "Blades in the Dark SRD",
      systemId: BLADES_SYSTEM_ID,
      licence: bladesLicence,
      visibility: "public",
    },
  },
];

export const firstPartySystem = (systemId: string) =>
  firstPartySystems.find((item) => item.system.id === systemId);
