# World export and import — design

A DM downloads a whole world as one file and can start a new world from it.
Importing always creates a new world; it never overwrites one, so a bad or
stale file can't destroy anything. Automatic backups can come later on the same
format (a DO alarm writing `world.json` next to the world's existing R2 files).

## What a world is

| Where             | What                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| World DO (SQLite) | templates, characters, messages, note metadata, scenes and the board, settings              |
|                   | compendium types, entries, tombstones, aliases; enabled library versions, overrides, blocks |
| R2                | note bodies, board images, character avatars (all under the world's `r2_prefix`)            |
| D1                | the world row and its members (who own characters, notes and messages)                      |

## The file

`<world-name>.ttrpg.zip`, stored uncompressed (images are compressed already;
notes are small):

```
world.json            the manifest below
notes/<noteId>.md
board/<assetId>
avatars/<file>
```

`world.json`, defined as an Effect Schema in `src/domain/world-export.ts` and
decoded on import — decoding is the validation:

```ts
{
  format: "ttrpg-world", version: 1, exportedAt,
  world: { name },
  members: [{ id, displayName, role }],       // names only: no emails, no accounts
  templates: SheetTemplate[],
  characters: (Character & { avatar?: path })[],
  board: { scenes, activeSceneId },           // snapshots as stored
  compendium: CompendiumPack,                 // the existing v2 pack: world entries + overrides
  libraries: [{ sourceId, version, mode }],   // pinned versions, by reference
  blocked: EntryId[],
  notes: (NoteSummary & { file: path })[],
  messages?: ChatMessage[],                   // when "include chat" is checked (default on)
  files: [{ path, contentType, size }],
}
```

Library text is never in the file: a world refers to library versions, which
the target corpus serves. Only the table's own writing (world entries and
overrides) travels, under its licence as before.

### Only what the exporting DM can see

The export uses the same visibility rules as the app (`canSeeNote`,
`visibleTo`). A DM can already see whispers and DM-only content, so those are
included, but players' private notes and other people's private rolls are not.
The export dialog says so.

## Export

- `GET /api/worlds/:id/export?chat=1` (DM only) returns `world.json`, built in
  the DO in one read so it's a consistent snapshot.
- The browser then fetches each listed file through the existing routes (board
  images, avatars, note bodies) and zips with `fflate`, streaming to a download.
  The Worker never buffers a whole world: worlds with many 10 MB images
  would exceed Worker memory and the request body limit.

## Import

Driven by the browser, so no single request carries the whole world:

1. **Read:** unzip in the browser, then check `world.json` decodes against the
   schema before sending anything.
2. **Create:** `POST /api/worlds/import` with `world.json`. This creates the D1
   world (the importer is owner and DM), then imports into the new DO in one
   transaction. Each row goes through the same save paths as normal edits
   (template limits, compendium rules, board migration for older snapshots),
   so every rule stays defined once. The response lists the files still to
   upload.
3. **Files:** `PUT /api/worlds/:id/import/files/<path>` for each file. This is
   accepted only for paths still pending in the DO (`import_pending`), with the
   same type and size limits as normal uploads.
4. **Finish:** the last file clears `import_pending`. Until then the world
   shows "Import incomplete — N files missing" with a button to resume from the
   same zip, and images not yet uploaded show as missing.

**Ids are kept.** Entry, character, note and asset ids are scoped to a DO, and
R2 keys to the world's prefix, so nothing needs remapping. The exception is
avatar keys, which store the full prefix and are rewritten to the new one.

**Members:** the original players don't exist in the new world.

- Every character arrives owned by the importing DM, with `formerPlayer` set
  to the original member's display name. A new **Played by** control (the DM
  picks a member, which clears `formerPlayer`) hands it over once players join.
  This control is useful anyway: today a character's player is fixed at creation.
- Notes keep their visibility, owned by the importer.
- Messages keep their author names and original member ids. Those ids match
  nobody in the new world, so old messages are nobody's to edit, and whispers
  stay visible to the DM.

**Libraries:** each pinned version is enabled if the target corpus has it.
Otherwise it's skipped and reported ("SRD 5.2 v3 isn't published here"), and
its overrides and blocks are kept, so they apply once the library is enabled.

**Versions:** the importer accepts `version` up to its own. Rows from older
versions decode through the same storage schemas and migrations that older DOs
already use.

## Slices

1. `world-export.ts` schema, the DO's export method and `GET …/export`.
   Miniflare test: export → import → export is equal, except for member mapping.
2. Import endpoints: create, pending files, the file route, and finishing.
   Tests: rejected and partial files, a library missing from the target,
   avatar key rewriting.
3. Client: an export dialog in world settings (DM only; "include chat",
   progress), "New world from backup" on the worlds page, and resume.
4. **Played by** on character sheets for the DM, plus `formerPlayer`.
5. e2e: build a world with a character, an avatar, a board image, a note and a
   library override; export, import and check them; then reassign the
   character.
