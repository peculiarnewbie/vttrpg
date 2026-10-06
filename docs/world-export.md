# World export and import

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

`<world-name>.ttrpg.zip`, stored uncompressed (the images in it are compressed
already):

```
world.json            WorldExport (src/domain/world-export.ts)
board/<assetId>
avatars/<file>
```

`world.json` is an Effect Schema, decoded on import — decoding is the
validation (`ImportedWorld` in `world-do.ts` adds the template and character
limits that normal saves use):

```ts
{
  format: "ttrpg-world", version: 1, exportedAt, exportedBy,  // exportedBy: a member id
  world: { name },
  members: [{ id, displayName, role }],       // names only: no emails, no accounts
  templates, characters,                      // avatarKey is a file path, not an R2 key
  scenes: [{ id, name, group, sort, snapshot }], activeSceneId,
  compendium: CompendiumPack,                 // the v2 pack: world entries + overrides
  libraries: [{ sourceId, version, mode }],   // by reference
  blocked: EntryId[],
  notes: Note[],                              // with their text
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

- `GET /api/worlds/:id/export?chat=0|1` (DM only) returns `world.json`. The DO
  reads SQLite in one go, then the note text and file sizes from R2.
- `GET /api/worlds/:id/export/files/<path>` (DM only) serves each listed file.
  The browser zips them with `fflate`. The Worker never holds a whole world:
  one with many 10 MB images would exceed Worker memory and the request limit.

## Import

Driven by the browser, so no single request carries the whole world:

1. **Read:** unzip in the browser and read `world.json`.
2. **Create:** `POST /api/worlds/import` with `world.json` (at most 30 MB, under
   the DO RPC limit). This creates the D1 world with the importer as owner and
   DM, then the DO writes the note text to R2 and the rows in one transaction.
   After that it enables libraries, imports the compendium pack through the
   normal pack import, and applies blocks. If any step fails, the world is
   removed from D1. The response lists the files still to upload.
3. **Files:** `PUT /api/worlds/:id/import/files/<path>` for each file. This is
   accepted only for paths still pending in the DO (`import_pending`), with the
   same type and size limits as normal uploads (`src/domain/uploads.ts`).
4. **Finish:** the last file clears `import_pending`. Until then the DM sees
   the world's unfinished import in its settings, with a way to resume from the
   same zip. Images not yet uploaded show as missing.

**Ids are kept.** Entry, character, note and asset ids are scoped to a DO, and
R2 keys to the world's prefix, so nothing needs remapping. Avatar paths are
turned back into keys under the new prefix.

**Members:** the original players don't exist in the new world.

- Every character arrives owned by the importing DM. Characters that weren't
  the exporter's carry `formerPlayer`, the original player's display name. The
  DM's **Played by** control hands a character to a member, which clears it.
- The exporter's notes and messages become the importer's.
- Other people's messages keep their author names and original member ids.
  Those ids match nobody in the new world, so the messages are nobody's to
  edit, and whispers stay visible to the DM.

**Libraries:** each version is enabled if the target corpus serves it.
Otherwise it's skipped and reported, along with the overrides and blocks that
belonged to it. Its entry types still come in as world types, as if the library
had been turned off, so enabling it later works.

**Versions:** the importer accepts `version` up to its own.
