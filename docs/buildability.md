# Buildability — each scope demand and the spec that proves it

[v1-scope.md](./v1-scope.md) says what the app must let a table build. This
maps each of its demands to the feature that meets it and the Playwright spec
(in `e2e/`, run in all three themes) that shows it working. A demand with no
spec is a gap; add the spec before calling it done.

Specs are named `file › test title`. Builder specs for the shipped systems use
world copies of the system's sheets and made-up entries (`e2e/system-world.ts`),
so they pass whether or not a library is published in local dev state; the
`systems.spec.ts` library tests skip when it isn't.

## First-party systems

| Demand                                      | Feature                                                        | Proved by                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A DM starts a world from a shipped system   | Game system setup adds sheets and enables the library          | `systems › a DM sets up Starforged and its character rolls action against challenge dice`                                                              |
| Licence and attribution stored as data      | `/legal` built from library manifests                          | `systems › the licences page credits every library's text`                                                                                             |
| **5e:** scale, stat blocks                  | SRD 5.2 library, compendium browser with facets                | `browser › filter spells by level and school, compare two, add one to a character`                                                                     |
| **5e:** class progression by level          | `progression` entry field; entry block's `progression` variant | `sheets › a class shows its progression up to the character's level`; `systems › Fifth Edition: rolls from derived modifiers, a spell from the SRD, …` |
| **5e:** character creation                  | 5e builder                                                     | `builder-dnd5e › a player builds a Fifth Edition character; …`                                                                                         |
| **Starforged:** oracles and rollable tables | Table fields; a roll shows the row it landed on                | `sheets › an oracle roll shows the row the dice landed on`; `systems › Starforged: an oracle roll shows the row the d100 landed on`                    |
| **Starforged:** progress tracks             | `progress` tracker display (ticks, boxes)                      | `sheets › progress tracks mark ticks and bulky items take two slots`                                                                                   |
| **Starforged:** character creation          | Starforged builder                                             | `builder-starforged › a player builds a Starforged character; …`                                                                                       |
| **Cairn:** item slots, bulky items          | List `slots` variant with `slotSize`                           | `sheets › progress tracks mark ticks and bulky items take two slots`                                                                                   |
| **Cairn:** rolling a background table       | Table dice inferred from the rows' span                        | `systems › Cairn: a background's table rolls the die its rows span`; `builder-cairn › …`                                                               |
| **Blades:** sheets that aren't characters   | Layout `subject: "shared"`; DM lock                            | `sheets › a shared crew sheet is everyone's until the DM locks it`                                                                                     |
| **Blades:** clocks                          | `clock` tracker display                                        | `sheets › a clock fills to the segment clicked, and clicking the last filled one empties it`                                                           |
| **Blades:** playbooks                       | `choose` filtered by the chosen playbook                       | `builder-blades › a player builds a scoundrel; the ability step offers only the playbook's abilities`                                                  |
| **Blades:** dice pools, zero dice keeps low | `kh1`/`z` notation composed from a sheet value                 | `dice › derived values show on the sheet and rolls resolve them`                                                                                       |

## Customisability target

Presets ship sheets and entry types, never rules text; the DM writes entries
from their book (`systems › Mythic Bastionland: …` checks a preset adds no
entries and that the DM can write the first one from the empty type).

| System             | Demand                                     | Feature                                                        | Proved by                                                                                                                   |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mythic Bastionland | Knights picked from the compendium         | Entry block linking a `knight`; its `fill` offers its Property | `builder-bastionland › a player builds a Knight step by step; only picks, edits and accepted offers reach the sheet`        |
| Mythic Bastionland | Virtues as trackers that roll their save   | Trackers (number or bar display) with a roll                   | `systems › Mythic Bastionland: unofficial sheets and entry types, and a Virtue rolls its save`                              |
| Mythic Bastionland | Property lists                             | List block (`slots` variant on the compact sheet)              | `builder-bastionland › …`                                                                                                   |
| Mythic Bastionland | Conditional blocks                         | `when` on blocks, builder steps and parts                      | `formulas › a computed value shows where it comes from, …`; `builder › steps and parts apply when their conditions hold, …` |
| Mothership         | Stats and saves as bars that roll the d100 | Stats `bars` variant with `max` and a roll                     | `systems › Mothership: stats roll the d100, [-] keeps the worse die, Panic rolls, gear comes from the compendium`           |
| Mothership         | Loadout lists fed from the compendium      | List `source: { entryType }`, "+ From compendium" copies a row | the same Mothership test; `compendium › a copied row offers the entry's changes and applies them only when asked`           |
| Mothership         | Stress and panic rolls                     | Rolls block (`2d100kh1`, `1d20`); stress as a tracker          | the same Mothership test                                                                                                    |
| Mothership         | Character creation                         | Mothership builder                                             | `builder-mothership › a player builds a Mothership crew member; …`                                                          |
| Stonetop           | Playbooks and moves                        | Entry block for the playbook; `choose` filtered by it          | `builder-stonetop › a player builds a Stonetop character; the Moves step only offers the playbook's moves`                  |
| Stonetop           | A sheet for the steading                   | Shared layout                                                  | `systems › Stonetop: a stat rolls 2d6 plus itself, and the steading is a shared sheet`                                      |

## Content and roll helpers

| Demand                                                    | Proved by                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Links to entries survive renames                          | `compendium › a link picked from suggestions keeps working after the entry is renamed`                                                                            |
| Copied rows remember their source and are offered updates | `compendium › a copied row offers the entry's changes and applies them only when asked`                                                                           |
| DM-only entries stay hidden until revealed                | `compendium › players find DM-only entries only once they're revealed`; `browser › DM-only entries show for the DM and never for players`                         |
| Libraries as pinned versions; overrides and blocks        | `corpus › libraries enable as pinned versions and show an explicit update summary`; `corpus › table overrides survive followed updates and blocked entries can …` |
| Derived values on the sheet and in roll notation          | `dice › derived values show on the sheet and rolls resolve them`; `formulas › the formula editor suggests values, shows the result and names mistakes`            |
| A typo in a roll is reported, not rolled                  | `dice › a typo in a roll is reported instead of rolled`                                                                                                           |
| Concurrent edits don't wipe what's being typed            | `sheets › text being typed survives an update to the character from elsewhere`                                                                                    |
| A world can be backed up and restored as a new world      | `backup › a backup becomes a new world, and the DM hands its characters back out`; `world-export.test.ts` (privacy, libraries, files)                             |

## Out of scope stays out

The scope forbids acting on a roll's result. These specs assert that the
helpers near that line stop short of it:

| Line                                           | Proved by                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Level-up shows a level and _offers_ to copy it | `sheets › a class shows its progression up to the character's level` (nothing is added until "Add level 2 to …" is clicked)                                                          |
| The builder never writes a roll into a stat    | `builder-rolls › a repeated roll posts one chat roll with its groups apart, and writes nothing`; `builder › opening the builder on a finished character and rolling changes nothing` |
| Tallies and cap hints never block              | `builder-budget › a budget tally follows the sheet live, writes nothing, and never blocks`                                                                                           |
| Opening or reviewing a builder writes nothing  | `builder-review › …`, `builder-assign › …`, `builder-options › …`, `builder-show › …`                                                                                                |
| Only committed numbers reach the sheet         | `builder-scores › a player sets a tracker and a stat; only committed numbers reach the sheet`                                                                                        |

## Gaps

- The Starforged starship and Blades crew builders have no browser spec; their
  parts are the same kinds the character builders exercise.
- The release checklist's grep for outcome words ("success", "hit") in chat and
  UI strings isn't automated ([v1-plan.md](./v1-plan.md), P7).
