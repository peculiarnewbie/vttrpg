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
  world: WorldSummary;
  member: WorldMember;
  members: WorldMember[];
  templates: SheetTemplate[];
  characters: Character[];
  messages: ChatMessage[];
  notes: NoteSummary[];
};

export const api = {
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
