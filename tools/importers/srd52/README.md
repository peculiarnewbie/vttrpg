# SRD 5.2 importer

`importSrd52From(dir, revision)` reads the cached Foundry dnd5e YAML without
network access. `importSrd52()` locates it through `upstream("dnd5e")`.
The source/system definitions are the committed first-party contract.

Only `*24` packs, explicitly CC-BY-4.0 documents, and 2024 rules are eligible.
Embedded monster items pass the same licence boundary independently. The YAML
metadata is decoded when read; `validateBundle` is the publication check.
No Effect runtime or server services are involved in this build-time reader.
The YAML parser comes from the existing Vite+ toolchain; HTML uses the existing
jsdom dependency. No dependencies were added.

IDs combine the upstream `_id` with a deterministic hash of its complete pack
UUID, preserving identity across renames and disambiguating case-folded IDs.
References are resolved against the selected documents. Progression and feature
ownership come from advancements; optional class features also inherit their
upstream class directory. Long bodies and structured rows split into numbered,
linked entries instead of being truncated. Uses and recharge remain prose.

## Pinned-source report

Foundry dnd5e revision `9e8bb7f383402a4b1df11270bf44c5a46101b7ae`:

| Type       | Entries |
| ---------- | ------: |
| spell      |     339 |
| monster    |     343 |
| weapon     |      42 |
| armor      |      14 |
| gear       |     193 |
| magic-item |     314 |
| class      |      12 |
| subclass   |      12 |
| feature    |     293 |
| species    |      14 |
| background |       4 |
| feat       |      17 |
| rule       |       0 |
| Total      |   1,597 |

`validateBundle` reports no problems. The largest published entry is Fighter,
`srd52/class/phbftrfighter000-0a8f955e`, at **6,964 bytes**, including the
validator's publishing metadata and licence budget. The committed fixture
subset is approximately 86 KB, with snapshots for all twelve eligible types.
There is no eligible upstream rule/table document for a positive rule fixture;
metadata-only exclusion fixtures exercise that boundary instead.

## Exclusions and conversion limits

- Missing/wrong licence or rules: 1 spell, 53 actors, 11 equipment documents,
  1 class-pack item, 43 content journals (858 pages without licence markers),
  45 tables, 391 standalone monster features, and 3 embedded monster items.
  The MIT code licence is not a substitute for the required SRD text marker.
- Foundry representations: 32 spell-effect/magic-item NPC tokens, 8 vehicles
  outside the requested NPC mapping, the supplemental Magical Berries inventory
  item, and 59 prefilled equipment inventory copies. Root equipment and packs
  retain their own entries. Artwork, image paths, artwork credits, secret notes
  and Foundry UI/automation advice are removed.
- Unlicensed embeds cannot supply rule glossary/condition text, roll tables,
  monster lore, species introductions or spell-slot tables. Existing licensed
  HTML tables are converted. Unresolved UUID/Reference links keep plain labels;
  missing embeds are omitted and counted in provenance.
- Spell-class lists are absent from the licensed spell documents, so the
  `classes` field is omitted. Class progression includes proficiency, granted
  features and all upstream scale values; it does not invent spell-slot data.
- Caster-dependent class-scale lookups link to the owning progression. Ability
  modifiers, character/class levels and floor/ceil expressions without caster
  state remain readable prose. Tree Stride has an unresolved activity lookup;
  that expression is recorded in provenance rather than assigned an invented
  value. Coin notation in Bag of Devouring, Land's Aid's variable healing dice,
  and Mirror Image's runtime duplicate-count roll remain prose. The exact
  expressions are recorded in each bundle's provenance.
- Summoned creatures retain the upstream stat-block overrides and spell-level
  bonuses. Their variable rolls use `spell_level`, `spell_mod`, `spell_attack`,
  `spell_dc` and `proficiency` sheet values, and do not infer caster state.
  Missing CR stays absent. The monster type select cannot represent
  Otherworldly Steed's Celestial/Fey/Fiend choice; it remains in the body.
  Werewolf's upstream type is literally `(lycanthrope)`, outside the select
  options; it also remains prose. The contract was not changed.
- The upstream Monk scale starts Focus Points at 1 on level 1. The importer
  preserves that supplied scale; it does not apply feature eligibility rules.

## Verification and merge

Run `pnpm exec vp test run tools/importers/srd52/index.test.ts` (fixture and
full-source tests), `pnpm typecheck`, `pnpm exec vp fmt tools/importers/srd52`,
and `pnpm exec vp lint`. The full test uses `it.skipIf` only when the cached
upstream is unavailable. The six pure tests cover snapshots, licence filtering,
HTML/enrichers, grouped rolls, identity, and splitting. Miniflare suites are
left to the orchestrator. Vite currently prints a shutdown-timeout warning after
passing tests; the command exits successfully.

At merge, register the importer in `tools/importers/index.ts`:

```ts
import { importSrd52 } from "./srd52";
```

```ts
srd52: importSrd52,
```

No publication, git operations, contract changes, or changes outside this
importer's directory were performed.
