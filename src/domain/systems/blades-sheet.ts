import type { SheetLayout } from "../sheet-layout";
import { bladesInTheDark } from "../sheet-presets";

/*
 * Blades in the Dark on generic blocks: the classic scoundrel page with each
 * action rollable as a dice pool (zero dots rolls two and keeps the lower),
 * special abilities from the library, and the crew as a shared sheet.
 */

const ACTIONS = [
  "hunt",
  "study",
  "survey",
  "tinker",
  "finesse",
  "prowl",
  "skirmish",
  "wreck",
  "attune",
  "command",
  "consort",
  "sway",
];

/** The preset's scoundrel page, with every action rolling its pool. */
const scoundrel = structuredClone(bladesInTheDark.pages[0]);
const rollable = (blocks: typeof scoundrel.blocks): typeof scoundrel.blocks =>
  blocks.map((block) =>
    block.type === "group"
      ? { ...block, blocks: rollable(block.blocks) as typeof block.blocks }
      : block.type === "trackers"
        ? {
            ...block,
            items: block.items.map((item) =>
              ACTIONS.includes(item.key) ? { ...item, roll: `(@${item.key})d6khz` } : item,
            ),
          }
        : block,
  );

export const bladesScoundrel: SheetLayout = {
  system: "Blades in the Dark",
  name: "Scoundrel",
  pages: [
    {
      ...scoundrel,
      blocks: [
        {
          id: "playbook-entry",
          type: "entry",
          key: "playbook_entry",
          entryType: "playbook",
          label: "Playbook",
          variant: "line",
        },
        ...rollable(scoundrel.blocks),
      ],
    },
    {
      id: "abilities",
      title: "Abilities & XP",
      blocks: [
        {
          id: "ability-list",
          type: "list",
          key: "abilities",
          title: "Special abilities",
          source: { entryType: "ability" },
          columns: [{ key: "name", label: "Ability", kind: "text" }],
        },
        {
          id: "xp",
          type: "trackers",
          variant: "boxes",
          items: [
            { key: "xp_playbook", label: "Playbook XP", min: 0, max: 8, start: 0 },
            { key: "xp_insight", label: "Insight XP", min: 0, max: 6, start: 0 },
            { key: "xp_prowess", label: "Prowess XP", min: 0, max: 6, start: 0 },
            { key: "xp_resolve", label: "Resolve XP", min: 0, max: 6, start: 0 },
          ],
        },
        {
          id: "friends",
          type: "list",
          key: "friends",
          title: "Friends & rivals",
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "standing", label: "Standing", kind: "select", options: ["Friend", "Rival"] },
          ],
        },
        {
          id: "coin",
          type: "stats",
          items: [
            { key: "coin", label: "Coin" },
            { key: "stash", label: "Stash" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};

export const bladesCrew: SheetLayout = {
  subject: "shared",
  system: "Blades in the Dark",
  name: "Crew",
  pages: [
    {
      id: "crew",
      title: "Crew",
      blocks: [
        {
          id: "crew-entry",
          type: "entry",
          key: "crew_entry",
          entryType: "crew",
          label: "Crew type",
          variant: "line",
        },
        {
          id: "about",
          type: "fields",
          variant: "inline",
          columns: 2,
          items: [
            { key: "reputation", label: "Reputation" },
            { key: "lair", label: "Lair" },
            { key: "hunting_grounds", label: "Hunting grounds" },
          ],
        },
        {
          id: "standing",
          type: "trackers",
          items: [
            { key: "rep", label: "Rep", min: 0, max: 12, start: 0 },
            { key: "heat", label: "Heat", min: 0, max: 9, start: 0 },
            { key: "wanted", label: "Wanted level", min: 0, max: 4, start: 0 },
            { key: "crew_xp", label: "Crew XP", min: 0, max: 8, start: 0 },
          ],
        },
        {
          id: "tier",
          type: "stats",
          items: [
            { key: "tier", label: "Tier" },
            { key: "coin", label: "Coin" },
          ],
        },
        {
          id: "hold",
          type: "checks",
          key: "hold",
          label: "Hold",
          variant: "tags",
          options: ["Weak", "Strong"],
        },
        {
          id: "crew-abilities",
          type: "list",
          key: "abilities",
          title: "Crew abilities",
          source: { entryType: "crew-ability" },
          columns: [{ key: "name", label: "Ability", kind: "text" }],
        },
        {
          id: "upgrades",
          type: "list",
          key: "upgrades",
          title: "Upgrades",
          source: { entryType: "upgrade" },
          columns: [
            { key: "name", label: "Upgrade", kind: "text" },
            { key: "cost", label: "Boxes", kind: "number" },
          ],
        },
        { id: "claims", type: "text", key: "claims", label: "Claims" },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "Fortune (Tier)", dice: "(@tier)d6khz" },
            { label: "Engagement", dice: "1d6" },
          ],
        },
      ],
    },
  ],
};
