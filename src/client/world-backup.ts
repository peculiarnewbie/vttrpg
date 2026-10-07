import * as Schema from "effect/Schema";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import {
  ImportStatus,
  WorldExport,
  WORLD_EXPORT_FORMAT,
  type ExportFile,
} from "../domain/world-export";
import type { WorldSummary } from "../domain/schemas";
import { fileSlug } from "../domain/compendium-io";
import { ApiError } from "./api";

/*
 * A world backup is a zip the browser builds and reads: world.json plus the
 * board images and avatars it lists (docs/world-export.md). The server only
 * ever sees world.json and one file at a time.
 */

export type BackupProgress = (done: number, total: number) => void;

const failure = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return new ApiError(data?.error ?? fallback);
};

/** Builds `<world>.ttrpg.zip` from the world's export and downloads it. */
export const downloadWorld = async (
  worldId: string,
  worldName: string,
  options: { chat: boolean },
  progress: BackupProgress,
) => {
  const base = `/api/worlds/${encodeURIComponent(worldId)}/export`;
  const response = await fetch(`${base}?chat=${options.chat ? 1 : 0}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw await failure(response, "Could not export this world");
  const text = await response.text();
  const data = Schema.decodeUnknownSync(WorldExport)(JSON.parse(text));
  // Images are compressed already, so nothing in the zip is compressed again.
  const zip: Zippable = { "world.json": [strToU8(text), { level: 0 }] };
  progress(0, data.files.length);
  for (const [index, file] of data.files.entries()) {
    const bytes = await fetch(`${base}/files/${file.path}`, { credentials: "same-origin" });
    // A file deleted since the export is left out; importing shows it as missing.
    if (bytes.ok) zip[file.path] = [new Uint8Array(await bytes.arrayBuffer()), { level: 0 }];
    progress(index + 1, data.files.length);
  }
  const url = URL.createObjectURL(
    new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileSlug(worldName) || "world"}.ttrpg.zip`;
  link.click();
  URL.revokeObjectURL(url);
};

export type Backup = { data: WorldExport; files: ReadonlyMap<string, Uint8Array> };

/** Reads a backup zip; the error says what's wrong in words a DM can act on. */
export const readBackup = async (file: File): Promise<Backup> => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ApiError("That file isn't a world backup (a .ttrpg.zip from this app).");
  }
  const json = entries["world.json"];
  if (!json) throw new ApiError("That zip has no world.json — is it a world backup?");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(json));
  } catch {
    throw new ApiError("The backup's world.json can't be read.");
  }
  const format = (parsed as { format?: unknown } | null)?.format;
  if (format !== WORLD_EXPORT_FORMAT)
    throw new ApiError("That file isn't a world backup (a .ttrpg.zip from this app).");
  const decoded = Schema.decodeUnknownResult(WorldExport)(parsed);
  if (decoded._tag === "Failure")
    throw new ApiError(
      "This backup was made by a newer version of the app, or is damaged, and can't be read.",
    );
  return { data: decoded.success, files: new Map(Object.entries(entries)) };
};

/** Uploads the files a world is waiting for; returns those the backup doesn't have. */
export const uploadPending = async (
  worldId: string,
  backup: Backup,
  pending: readonly ExportFile[],
  progress: BackupProgress,
) => {
  const missing: string[] = [];
  progress(0, pending.length);
  for (const [index, file] of pending.entries()) {
    const bytes = backup.files.get(file.path);
    if (!bytes) missing.push(file.path);
    else {
      const response = await fetch(
        `/api/worlds/${encodeURIComponent(worldId)}/import/files/${file.path}`,
        {
          method: "PUT",
          headers: { "content-type": file.contentType },
          body: bytes as Uint8Array<ArrayBuffer>,
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw await failure(response, "Could not upload a file from the backup");
    }
    progress(index + 1, pending.length);
  }
  return missing;
};

/** Starts a new world from a backup and uploads its files. */
export const importWorld = async (backup: Backup, progress: BackupProgress) => {
  const response = await fetch("/api/worlds/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup.data),
    credentials: "same-origin",
  });
  if (!response.ok) throw await failure(response, "Could not import this world");
  const body = (await response.json()) as { world: WorldSummary; status: unknown };
  const status = Schema.decodeUnknownSync(ImportStatus)(body.status);
  const missing = await uploadPending(body.world.id, backup, status.pending, progress);
  return { world: body.world, status, missing };
};
