# Version 1.0 scope

Tabletop is a place for a group to keep and share a game: sheets, content,
dice, chat, notes, and a mood board. It is deliberately **not** a rules engine.

The principle: **the app helps you make a roll; it never handles the roll's
side effects.** Getting to the dice — the content, the notation, the values a
sheet derives — is ours. What the roll then means and changes — hits, damage,
spent resources, conditions — is managed by the DM and players.

This document fixes what 1.0 includes and — just as important — what it never
will. The corpus architecture that backs it is in [corpus.md](./corpus.md).

## First-party systems

1.0 ships four systems whose rules text is openly licensed. Each comes with
sheet layouts, entry types, and its reference content as a first-party
library, with the licence and attribution stored as data.

| System                           | Licence      | What it proves                                           |
| -------------------------------- | ------------ | -------------------------------------------------------- |
| D&D 5e — SRD 5.2 (5.1 to follow) | CC BY 4.0    | Scale, stat blocks, class progression by level           |
| Ironsworn: Starforged            | CC BY 4.0    | Oracles and rollable tables, moves, asset cards          |
| Cairn 2e                         | CC BY-SA 4.0 | Light OSR close to Mythic Bastionland; item slots        |
| Blades in the Dark (SRD)         | CC BY 3.0    | Sheets that aren't characters (crews), playbooks, clocks |

Licences cover text only — never art or logos — and none of them allows
implying endorsement. The UI says "based on X", never "official X".
Share-alike content (Cairn) stays under its licence in overrides and exports.

## Customisability target

Beyond the four, 1.0 must be flexible enough for a DM to build these systems
themselves, with content they supply. We ship layouts and entry types for them
where we already have them, never their rules text:

| System             | What it demands of the tools                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Mythic Bastionland | Knights picked from the compendium, Virtues as boxed trackers, Property lists, conditional blocks |
| Mothership         | Stats and saves as bars, loadout lists fed from the compendium, stress/panic rolls                |
| Stonetop           | Playbooks and moves, and a sheet for the steading (the village) — a second non-character sheet    |

If one of these can't be built with layouts, entry types, and the compendium,
that is a gap in the tools, not a reason to hard-code the system.

## In scope: content and roll helpers

**Content.** Sheets as data (pages of generic blocks, per-player styles);
the compendium (entry types, entries, libraries, links, overrides); a
dedicated compendium page for browsing; importers for the first-party
libraries and for content people write themselves.

**Roll helpers.** Everything that gets a player to the dice:

- Click to roll dice written in content: sheet rolls, list-row dice, dice in
  entry cards and monster actions, labelled with what was rolled
  ("Longsword · d8").
- Compose notation from a sheet's current values when the author says so
  (d20 + a modifier field); advantage, keep-highest, dice pools.
- Roll on a table (an oracle) and show the row the dice landed on.
- Derived display values the sheet author defines — a modifier from a score,
  a total from several fields — shown on the sheet and usable in roll
  notation. They are computed from other values, never stored or written back.

The chat shows dice and totals. It never says what a result means: no
"success", "strong hit", "hit", or "save failed".

## Out of scope, permanently

These are all side effects of rolls, or rules around them. The DM and players
manage them; the app only holds whatever values they set.

- **Movement and measurement**: grids that enforce distance, movement
  allowances, reach, line of sight, areas of effect.
- **Targeting**: selecting tokens or characters as targets of anything.
- **Automatic stat updates**: applying damage or healing, spending resources,
  ticking spell slots or ammo, conditions that change numbers, rests.
- **Outcome evaluation**: comparing rolls to DCs, AC, or difficulty; deciding
  hits, successes, or degrees of success.
- **Rule enforcement**: prerequisites, encumbrance limits, legal character
  builds, action economy. Level-up shows what a level grants and can _offer_
  to copy it onto a sheet; it never validates or applies choices.
- **Combat automation**: initiative that advances itself, turn enforcement,
  effect durations.

When a request lands near this line, the test is: does it help someone make a
roll or read content (in), or does it act on a roll's result — deciding what
happened or changing game state on the table's behalf (out)?

## Decided along the way

- Entries live per world today; libraries (sources) are how content is shared
  and versioned at D&D scale — see [corpus.md](./corpus.md).
- The compendium is DM-edited; players read revealed entries.
- Sheets link single entries live and copy entries into list rows, which
  remember their source and are offered updates, never changed silently.
