import * as Schema from "effect/Schema";
import { BoardAssetId, BoardSnapshot, MAX_BOARD_SCENES, SceneName } from "./board";
import { CompendiumPack } from "./compendium";
import { SourceMode } from "./corpus-rpc";
import { Character, ChatMessage, MemberRole, Note, SheetTemplate } from "./schemas";

/*
 * A whole world as one file: `world.json` (this schema) plus the binary files
 * it lists, zipped by the browser. Library text never travels — a world refers
 * to library versions by id; only the table's own writing (world entries and
 * overrides, in `compendium`) is in the file. See docs/world-export.md.
 */

export const WORLD_EXPORT_FORMAT = "ttrpg-world";
export const WORLD_EXPORT_VERSION = 1;
/** Kept under the Durable Object RPC argument limit (32 MiB). */
export const MAX_WORLD_EXPORT_BYTES = 30 * 1024 * 1024;

/** Where a file sits in the zip and, under the world's R2 prefix, in storage. */
export const ExportFilePath = Schema.String.check(
  Schema.isPattern(/^(board\/[a-zA-Z0-9_-]{1,80}|avatars\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,119})$/),
);
export type ExportFilePath = typeof ExportFilePath.Type;

export const ExportFile = Schema.Struct({
  path: ExportFilePath,
  contentType: Schema.String.check(Schema.isMaxLength(100)),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ExportFile = typeof ExportFile.Type;

export const ExportScene = Schema.Struct({
  id: BoardAssetId,
  name: SceneName,
  group: Schema.NullOr(SceneName),
  sort: Schema.Int,
  snapshot: BoardSnapshot,
});
export type ExportScene = typeof ExportScene.Type;

export const ExportLibrary = Schema.Struct({
  sourceId: Schema.String,
  version: Schema.Int,
  mode: SourceMode,
});
export type ExportLibrary = typeof ExportLibrary.Type;

/** What the world DO holds, as exported; avatar keys are file paths, not R2 keys. */
export const WorldContents = Schema.Struct({
  templates: Schema.Array(SheetTemplate),
  characters: Schema.Array(Character),
  scenes: Schema.Array(ExportScene).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_BOARD_SCENES),
    Schema.makeFilter((scenes) => new Set(scenes.map((scene) => scene.id)).size === scenes.length, {
      expected: "Scene ids to be unique",
    }),
  ),
  activeSceneId: BoardAssetId,
  compendium: CompendiumPack,
  libraries: Schema.Array(ExportLibrary),
  blocked: Schema.Array(Schema.String),
  notes: Schema.Array(Note),
  messages: Schema.optionalKey(Schema.Array(ChatMessage)),
  files: Schema.Array(ExportFile),
});
export type WorldContents = typeof WorldContents.Type;

export const WorldExport = Schema.Struct({
  format: Schema.Literal(WORLD_EXPORT_FORMAT),
  version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WORLD_EXPORT_VERSION })),
  exportedAt: Schema.String,
  /** The member who exported it: their characters, notes and messages come back as the importer's. */
  exportedBy: Schema.String,
  world: Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  }),
  /** Names only — no emails or accounts leave the table. */
  members: Schema.Array(
    Schema.Struct({ id: Schema.String, displayName: Schema.String, role: MemberRole }),
  ),
  ...WorldContents.fields,
}).check(
  Schema.makeFilter((data) => data.scenes.some((scene) => scene.id === data.activeSceneId), {
    expected: "The active scene to be one of the scenes",
  }),
);
export type WorldExport = typeof WorldExport.Type;

/** What an import left to do or couldn't do. */
export const ImportStatus = Schema.Struct({
  worldId: Schema.String,
  pending: Schema.Array(ExportFile),
  /** Libraries the target corpus doesn't serve at the exported version. */
  skippedLibraries: Schema.Array(Schema.String),
  /** Overrides and blocks that belonged to those libraries. */
  skippedEntries: Schema.Int,
});
export type ImportStatus = typeof ImportStatus.Type;

/** `world/<id>/avatars/<file>` ↔ `avatars/<file>`. */
export const avatarPath = (key: string): ExportFilePath | undefined => {
  const file = key.split("/").pop();
  return file && Schema.is(ExportFilePath)(`avatars/${file}`) ? `avatars/${file}` : undefined;
};
