import * as Schema from "effect/Schema";
import {
  WorldLibraries,
  WorldSource,
  LibraryEntryDiff,
  BlockedEntries,
  type EnableSourceInput,
} from "../domain/corpus-rpc";
import { EntryOverride, type SaveOverrideInput } from "../domain/overrides";
import {
  Compendium,
  CompendiumEntry,
  CompendiumPack,
  EntryType,
  EntryBodies,
  EntryBodiesInput,
  IndexDelta,
  compendiumLimits,
  ImportPackResult,
  type SaveEntryInput,
} from "../domain/compendium";
import {
  BoardAssetId,
  BoardSnapshot,
  SceneList,
  type CreateSceneInput,
  type UpdateSceneInput,
  type SceneMetadata,
} from "../domain/board";
import type {
  ChatMessage,
  CreateMemberInput,
  SaveCharacterInput,
  SaveNoteInput,
  SaveTemplateInput,
  SheetTemplate,
  UpdateMemberInput,
  WorldMember,
  MemberRole,
  Note,
  NoteSummary,
  Character,
  AuthUser,
  WorldSummary,
} from "../domain/schemas";

export class ApiError extends Error {}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(data?.error ?? `Request failed (${response.status})`);
  }
  return data as T;
};

export type WorldBootstrap = {
  features?: { corpus: boolean };
  board: BoardSnapshot;
  scenes?: SceneMetadata[];
  activeSceneId?: string;
  world: WorldSummary;
  member: WorldMember;
  members: WorldMember[];
  templates: SheetTemplate[];
  characters: Character[];
  messages: ChatMessage[];
  hasMoreMessages: boolean;
  notes: NoteSummary[];
};

export const api = {
  libraries: async (worldId: string) =>
    Schema.decodeUnknownSync(WorldLibraries)(
      await request(`/api/worlds/${encodeURIComponent(worldId)}/libraries`),
    ),
  checkLibraries: async (worldId: string) =>
    Schema.decodeUnknownSync(WorldLibraries)(
      await request(`/api/worlds/${encodeURIComponent(worldId)}/libraries/check`, {
        method: "POST",
      }),
    ),
  enableLibrary: async (worldId: string, sourceId: string, input: EnableSourceInput) =>
    Schema.decodeUnknownSync(WorldSource)(
      await request(
        `/api/worlds/${encodeURIComponent(worldId)}/libraries/${encodeURIComponent(sourceId)}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    ),
  disableLibrary: async (worldId: string, sourceId: string): Promise<void> => {
    await request(
      `/api/worlds/${encodeURIComponent(worldId)}/libraries/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
    );
  },
  blockedEntries: async (worldId: string) =>
    Schema.decodeUnknownSync(BlockedEntries)(
      await request(`/api/worlds/${encodeURIComponent(worldId)}/libraries/blocked`),
    ),
  libraryEntryDiff: async (worldId: string, sourceId: string, entryId: string) =>
    Schema.decodeUnknownSync(LibraryEntryDiff)(
      await request(
        `/api/worlds/${encodeURIComponent(worldId)}/libraries/${encodeURIComponent(sourceId)}/diff/${encodeURIComponent(entryId)}`,
      ),
    ),
  blockEntry: async (worldId: string, entryId: string, blocked: boolean): Promise<void> => {
    await request(
      `/api/worlds/${encodeURIComponent(worldId)}/compendium/blocked/${encodeURIComponent(entryId)}`,
      { method: blocked ? "PUT" : "DELETE" },
    );
  },
  entryOverride: async (worldId: string, entryId: string) =>
    Schema.decodeUnknownSync(Schema.NullOr(EntryOverride))(
      await request(
        `/api/worlds/${encodeURIComponent(worldId)}/compendium/overrides/${encodeURIComponent(entryId)}`,
      ),
    ),
  saveEntryOverride: async (worldId: string, entryId: string, input: SaveOverrideInput) =>
    Schema.decodeUnknownSync(EntryOverride)(
      await request(
        `/api/worlds/${encodeURIComponent(worldId)}/compendium/overrides/${encodeURIComponent(entryId)}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    ),
  deleteEntryOverride: async (worldId: string, entryId: string): Promise<void> => {
    await request(
      `/api/worlds/${encodeURIComponent(worldId)}/compendium/overrides/${encodeURIComponent(entryId)}`,
      { method: "DELETE" },
    );
  },
  getCompendiumIndex: async (worldId: string, since: number) =>
    Schema.decodeUnknownSync(IndexDelta)(
      await request(`/api/worlds/${encodeURIComponent(worldId)}/compendium/index?since=${since}`),
    ),
  getEntryBodies: async (worldId: string, ids: readonly string[]) => {
    if (ids.length > compendiumLimits.bodiesPerRequest) {
      throw new ApiError(`At most ${compendiumLimits.bodiesPerRequest} entry ids per request`);
    }
    const input = Schema.decodeUnknownSync(EntryBodiesInput)({ ids });
    return Schema.decodeUnknownSync(EntryBodies)(
      await request(`/api/worlds/${encodeURIComponent(worldId)}/compendium/bodies`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  getCompendium: async (worldId: string) =>
    Schema.decodeUnknownSync(Compendium)(await request(`/api/worlds/${worldId}/compendium`)),
  saveEntryType: async (worldId: string, input: EntryType) =>
    Schema.decodeUnknownSync(EntryType)(
      await request(`/api/worlds/${worldId}/compendium/types/${encodeURIComponent(input.id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    ),
  deleteEntryType: async (worldId: string, typeId: string): Promise<void> => {
    await request(`/api/worlds/${worldId}/compendium/types/${encodeURIComponent(typeId)}`, {
      method: "DELETE",
    });
  },
  saveEntry: async (worldId: string, input: SaveEntryInput) =>
    Schema.decodeUnknownSync(CompendiumEntry)(
      await request(`/api/worlds/${worldId}/compendium/entries`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  deleteEntry: async (worldId: string, entryId: string): Promise<void> => {
    await request(`/api/worlds/${worldId}/compendium/entries/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
    });
  },
  exportCompendium: async (worldId: string) =>
    Schema.decodeUnknownSync(CompendiumPack)(
      await request(`/api/worlds/${worldId}/compendium/export`),
    ),
  importCompendium: async (worldId: string, input: CompendiumPack) =>
    Schema.decodeUnknownSync(ImportPackResult)(
      await request(`/api/worlds/${worldId}/compendium/import`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  listScenes: async (worldId: string) =>
    Schema.decodeUnknownSync(SceneList)(await request(`/api/worlds/${worldId}/scenes`)),
  createScene: async (worldId: string, input: typeof CreateSceneInput.Type) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/scenes`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  getScene: async (worldId: string, sceneId: string) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/scenes/${encodeURIComponent(sceneId)}`),
    ),
  publishScene: async (worldId: string, sceneId: string, input: BoardSnapshot) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/scenes/${encodeURIComponent(sceneId)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    ),
  updateScene: async (worldId: string, sceneId: string, input: typeof UpdateSceneInput.Type) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/scenes/${encodeURIComponent(sceneId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  deleteScene: async (worldId: string, sceneId: string) =>
    Schema.decodeUnknownSync(SceneList)(
      await request(`/api/worlds/${worldId}/scenes/${encodeURIComponent(sceneId)}`, {
        method: "DELETE",
      }),
    ),
  activateScene: async (worldId: string, sceneId: string) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/scenes/${encodeURIComponent(sceneId)}/active`, {
        method: "POST",
      }),
    ),
  getBoard: async (worldId: string) =>
    Schema.decodeUnknownSync(BoardSnapshot)(await request(`/api/worlds/${worldId}/board`)),
  publishBoard: async (worldId: string, input: BoardSnapshot) =>
    Schema.decodeUnknownSync(BoardSnapshot)(
      await request(`/api/worlds/${worldId}/board`, { method: "PUT", body: JSON.stringify(input) }),
    ),
  boardImageUrl: (worldId: string, assetId: string) =>
    `/api/worlds/${worldId}/board/images/${encodeURIComponent(assetId)}`,
  uploadBoardImage: async (worldId: string, file: Blob) => {
    const response = await fetch(`/api/worlds/${worldId}/board/images`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError("Could not upload image (PNG, JPEG, or WebP, up to 5MB)");
    return Schema.decodeUnknownSync(Schema.Struct({ assetId: BoardAssetId }))(data);
  },
  me: () => request<{ user: AuthUser | null; worlds: WorldSummary[] }>("/api/me"),
  google: (email: string, displayName: string) =>
    request<{ user: AuthUser }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ email, displayName }),
    }),
  login: (username: string, password: string) =>
    request<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  createWorld: (name: string) =>
    request<WorldSummary>("/api/worlds", { method: "POST", body: JSON.stringify({ name }) }),
  bootstrapWorld: (worldId: string) => request<WorldBootstrap>(`/api/worlds/${worldId}`),
  fetchMessages: (
    worldId: string,
    options: { before?: string; beforeId?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.before) query.set("before", options.before);
    if (options.beforeId) query.set("beforeId", options.beforeId);
    if (options.limit) query.set("limit", String(options.limit));
    return request<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/api/worlds/${worldId}/messages${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  uploadAvatar: async (worldId: string, characterId: string, file: File) => {
    const response = await fetch(`/api/worlds/${worldId}/characters/${characterId}/avatar`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
      credentials: "same-origin",
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(data?.error ?? "Could not upload picture");
    return data as Character;
  },
  avatarUrl: (worldId: string, characterId: string, avatarKey: string) =>
    `/api/worlds/${worldId}/characters/${characterId}/avatar?v=${encodeURIComponent(avatarKey)}`,
  listMembers: (worldId: string) => request<WorldMember[]>(`/api/worlds/${worldId}/members`),
  createMember: (worldId: string, input: CreateMemberInput) =>
    request<WorldMember>(`/api/worlds/${worldId}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMember: (worldId: string, memberId: string, input: UpdateMemberInput) =>
    request<WorldMember>(`/api/worlds/${worldId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteMember: (worldId: string, memberId: string) =>
    request<{ ok: true }>(`/api/worlds/${worldId}/members/${memberId}`, { method: "DELETE" }),

  saveTemplate: (worldId: string, input: SaveTemplateInput) =>
    request<SheetTemplate>(`/api/worlds/${worldId}/templates`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  saveCharacter: (worldId: string, input: SaveCharacterInput) =>
    request<Character>(`/api/worlds/${worldId}/characters`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteCharacter: (worldId: string, characterId: string) =>
    request<{ ok: true }>(`/api/worlds/${worldId}/characters/${characterId}`, {
      method: "DELETE",
    }),

  listNotes: (worldId: string) => request<NoteSummary[]>(`/api/worlds/${worldId}/notes`),
  getNote: (worldId: string, noteId: string) =>
    request<Note>(`/api/worlds/${worldId}/notes/${noteId}`),
  saveNote: (worldId: string, noteId: string, input: SaveNoteInput) =>
    request<Note>(`/api/worlds/${worldId}/notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteNote: (worldId: string, noteId: string) =>
    request<{ ok: true }>(`/api/worlds/${worldId}/notes/${noteId}`, { method: "DELETE" }),
};

export type { MemberRole };
