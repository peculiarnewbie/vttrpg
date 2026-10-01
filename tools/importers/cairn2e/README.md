# Cairn Second Edition importer

Read-only filesystem import from the official Cairn site repository:
https://github.com/yochaigal/cairn, revision 2b531b49462ed322c17c7e6e8c0d178ca4246b2d.
The upstream README licenses the full text under CC BY-SA 4.0. No per-page
licence exceptions occur in the selected guide/background Markdown.
Attribution is supplied by the unchanged Cairn system/source contract.

Exports `importCairn2eFrom(dir, revision)` (repository or second-edition directory)
and `importCairn2e()` (the pinned `upstream("cairn")` checkout).
The importer does not publish, fetch, or change any source files.

| Type       | Entries |
| ---------- | ------: |
| background |      20 |
| item       |      83 |
| monster    |      84 |
| relic      |      46 |
| rule       |     268 |
| spellbook  |     100 |
| table      |     150 |

Largest published entry, including the validator's publication envelope:
`cairn2e/rule/wardens-guide-forest-seeds-trails-old-logging-roa-0b50968c18`, **11434 bytes**.
`validateBundle(bundle).problems` is empty. Counts include linked split parts.
Long sections split at paragraphs, sentences, or table rows without truncation;
table fragments repeat their headers. Each part links to all other parts.

Entry identity comes from filenames and upstream section headings. Tables also
use their header/column labels; packed numbering columns merge into one oracle.
Anonymous NPC name tables and duplicate-labelled columns use the first outcome
as their distinguishing key because upstream supplies no separate anchors.
They keep their ids across reordering and sibling removal; changing that first
outcome changes the identity of an otherwise unidentified upstream table.
Background table references are derived once from the finished entry ids.
Monster attack alternatives are separate rows. Cairn's multi-attack plus sign
means independent damage dice, so these use `|` groups rather than summing.
Marketplace weapon/tool groups remain one entry per priced upstream row.

Merge actions:

- Register in tools/importers/index.ts:
  `import { importCairn2e } from "./cairn2e";`
  and the registry line `cairn2e: importCairn2e,`.
- The table oracle field currently fixes all entries to `1d6`. The upstream
  roll tables require **1d6, 1d10, 1d20, 1d100, and 2d6**. All ranges and actual
  dice are preserved, and the body offers the correct roll, but the field's
  oracle button uses the contract's die. Decide between per-die table types
  and a per-entry dice field before publishing. No d4/d8/d12 oracle tables
  appear in this revision (those dice occur elsewhere in rules/attacks).
- Hydra occurs in Lizard and Mythical; the first group, Lizard, is retained.
  Sphinx has a stat block but no category-table membership; its group is omitted.

Art, image paths, Jekyll metadata, downloads, tools, first-edition text, and
third-party linked book contents are excluded. External text links are retained;
unresolvable internal links retain plain labels. The upstream example forest
Encounters table says d20 but supplies only results 1–6: preserved in rule text,
omitted from oracle entries. Scars is indexed by HP lost, not a random die, and
remains a rule table. Growth and Warden's Bonds and Omens contain prose rather
than roll tables; Player's Bonds and Omens are imported as oracles.

Validation: fixture and complete-source tests, `pnpm typecheck`,
`pnpm exec vp fmt tools/importers/cairn2e/*.ts`, and `pnpm exec vp lint`.
The ten pure tests pass. Vite emits a shutdown-timeout diagnostic after passing
but returns exit code 0. Miniflare suites remain for the orchestrator.
