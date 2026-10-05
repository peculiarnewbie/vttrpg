import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * Blades in the Dark on generic blocks: the classic scoundrel page with each
 * action rollable as a dice pool (zero dots rolls two and keeps the lower),
 * special abilities from the library, and the crew as a shared sheet.
 *
 * The builders walk the same values the sheets edit: pick the DM-written
 * playbook or crew entry, fill in the sheet's own blocks, and add abilities
 * or upgrades from that entry's references. They offer and roll only; the
 * player writes everything.
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

/** Step-by-step over the scoundrel sheet: playbook, details, actions, one ability, review. */
const scoundrelBuilder: SheetBuilder = {
  steps: [
    {
      id: "playbook",
      title: "Playbook",
      hint: "Pick the playbook entry your table wrote for this scoundrel.",
      parts: [{ type: "choose", key: "playbook_entry" }],
    },
    {
      id: "details",
      title: "Details",
      hint: "Choose a heritage and a vice, then write in your look.",
      parts: [
        {
          type: "options",
          key: "heritage",
          options: [
            { label: "Akoros" },
            { label: "The Dagger Isles" },
            { label: "Iruvia" },
            { label: "Severos" },
            { label: "Skovlan" },
            { label: "Tycheros" },
          ],
        },
        {
          type: "options",
          key: "vice",
          options: [
            { label: "Faith" },
            { label: "Gambling" },
            { label: "Luxury" },
            { label: "Obligation" },
            { label: "Pleasure" },
            { label: "Stupor" },
            { label: "Weird" },
          ],
        },
        { type: "blocks", blocks: ["who"] },
      ],
    },
    {
      id: "actions",
      title: "Actions",
      hint: "Mark your playbook's starting dots, then add four more — usually no more than two in any action.",
      parts: [
        {
          type: "budget",
          label: "Action dots",
          spent: ACTIONS.map((key) => `@${key}`).join(" + "),
          total: "7",
          items: ACTIONS.map((key) => ({ key, cap: 2 })),
        },
        { type: "blocks", blocks: ["insight", "prowess", "resolve"] },
      ],
    },
    {
      id: "ability",
      title: "Special ability",
      hint: "Pick one of the abilities listed on your playbook.",
      parts: [
        {
          type: "choose",
          key: "abilities",
          from: { entry: "playbook_entry", field: "abilities" },
          pick: 1,
        },
      ],
    },
    {
      id: "review",
      title: "Review",
      hint: "Look the sheet over and fill in anything left blank.",
      parts: [{ type: "review" }, { type: "blocks", blocks: ["stress", "trauma", "harm", "load"] }],
    },
  ],
};

/** The crew's short builder: its entry, its details, then abilities and upgrades from it. */
const crewBuilder: SheetBuilder = {
  steps: [
    {
      id: "crew",
      title: "Crew",
      hint: "Pick the crew entry your table wrote.",
      parts: [{ type: "choose", key: "crew_entry" }],
    },
    {
      id: "details",
      title: "Details",
      hint: "Fill in the crew's details, tier and hold.",
      parts: [{ type: "blocks", blocks: ["about", "standing", "tier", "hold"] }],
    },
    {
      id: "abilities",
      title: "Abilities",
      hint: "Pick the abilities listed on your crew entry.",
      parts: [
        {
          type: "choose",
          key: "abilities",
          from: { entry: "crew_entry", field: "abilities" },
          pick: 1,
        },
      ],
    },
    {
      id: "upgrades",
      title: "Upgrades",
      hint: "Add the upgrades listed on your crew entry.",
      parts: [
        { type: "choose", key: "upgrades", from: { entry: "crew_entry", field: "upgrades" } },
      ],
    },
  ],
};

const action = (key: string, label: string) => ({ key, label, min: 0, max: 4, start: 0 });

/** The classic scoundrel page; the Scoundrel sheet adds rolls and the playbook link. */
export const bladesInTheDark: SheetLayout = {
  system: "Blades in the Dark",
  name: "Classic",
  pages: [
    {
      id: "scoundrel",
      title: "Scoundrel",
      blocks: [
        {
          id: "who",
          type: "fields",
          variant: "inline",
          columns: 2,
          items: [
            { key: "playbook", label: "Playbook" },
            { key: "heritage", label: "Heritage" },
            { key: "vice", label: "Vice" },
            { key: "look", label: "Look" },
          ],
        },
        {
          id: "condition",
          type: "group",
          wide: 3,
          blocks: [
            {
              id: "stress",
              type: "trackers",
              items: [{ key: "stress", label: "Stress", min: 0, max: 9, start: 0 }],
            },
            {
              id: "trauma",
              type: "checks",
              key: "trauma",
              label: "Trauma",
              variant: "tags",
              options: [
                "Cold",
                "Haunted",
                "Obsessed",
                "Paranoid",
                "Reckless",
                "Soft",
                "Unstable",
                "Vicious",
              ],
            },
            {
              id: "harm",
              type: "list",
              key: "harm",
              title: "Harm",
              columns: [
                { key: "level", label: "Lvl", kind: "number" },
                { key: "harm", label: "Harm", kind: "text" },
              ],
              slots: 3,
            },
          ],
        },
        {
          id: "clocks",
          type: "trackers",
          variant: "boxes",
          wide: 3,
          items: [
            { key: "healing", label: "Healing", min: 0, max: 4, start: 0, display: "clock" },
            { key: "vendetta", label: "Vendetta", min: 0, max: 8, start: 0, display: "clock" },
          ],
        },
        {
          id: "insight",
          type: "group",
          title: "Insight",
          variant: "framed",
          span: 3,
          wide: 2,
          blocks: [
            {
              id: "insight-actions",
              type: "trackers",
              items: [
                action("hunt", "Hunt"),
                action("study", "Study"),
                action("survey", "Survey"),
                action("tinker", "Tinker"),
              ],
            },
          ],
        },
        {
          id: "prowess",
          type: "group",
          title: "Prowess",
          variant: "framed",
          span: 3,
          wide: 2,
          blocks: [
            {
              id: "prowess-actions",
              type: "trackers",
              items: [
                action("finesse", "Finesse"),
                action("prowl", "Prowl"),
                action("skirmish", "Skirmish"),
                action("wreck", "Wreck"),
              ],
            },
          ],
        },
        {
          id: "resolve",
          type: "group",
          title: "Resolve",
          variant: "framed",
          span: 6,
          wide: 2,
          blocks: [
            {
              id: "resolve-actions",
              type: "trackers",
              items: [
                action("attune", "Attune"),
                action("command", "Command"),
                action("consort", "Consort"),
                action("sway", "Sway"),
              ],
            },
          ],
        },
        {
          id: "load",
          type: "list",
          key: "items",
          title: "Load",
          wide: 4,
          columns: [
            { key: "carried", label: "", kind: "check" },
            { key: "item", label: "Item", kind: "text" },
            { key: "load", label: "Load", kind: "number" },
          ],
        },
        {
          id: "roll",
          type: "rolls",
          wide: 2,
          items: [
            { label: "Action", dice: "2d6" },
            { label: "Resist", dice: "1d6" },
          ],
        },
      ],
    },
  ],
};

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
  builder: scoundrelBuilder,
  pages: [
    {
      ...scoundrel,
      blocks: [
        {
          id: "playbook-entry",
          type: "entry",
          key: "playbook_entry",
          entryType: "playbook",
          label: "Playbook sheet",
          variant: "line",
          // The SRD has no playbooks: a DM-written one shows once linked (the picker shows while editing).
          when: { key: "playbook_entry", is: "filled" },
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
  builder: crewBuilder,
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
          when: { key: "crew_entry", is: "filled" },
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
