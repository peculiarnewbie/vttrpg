import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { HttpServerError } from "effect/unstable/http/HttpServerError";
import {
  CreateMemberInput,
  CreateWorldInput,
  DevGoogleInput,
  LoginInput,
  SaveCharacterInput,
  SaveNoteInput,
  SaveTemplateInput,
  UpdateMemberInput,
  type ChatMessage,
  type MemberRole,
  type Note,
  type NoteSummary,
  type WorldMember,
  type WorldSummary,
} from "../domain/schemas";
import { hashPassword, randomToken, verifyPassword } from "./crypto";
import * as repo from "./db";
import {
  BadRequest,
  Bucket,
  CurrentUser,
  D1,
  Forbidden,
  NotFound,
  Unauthorized,
  WorldNamespace,
  requireUser,
  type ApiError,
} from "./services";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const SESSION_COOKIE = "ttrpg_session";

type Stub = ReturnType<DurableObjectNamespace["getByName"]>;

const readBody = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text;
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        return yield* Effect.fail(new BadRequest({ message: "Invalid JSON body" }));
      }
    }
    const decoded = Schema.decodeUnknownResult(schema)(parsed);
    if (decoded._tag === "Failure") {
      return yield* Effect.fail(new BadRequest({ message: "Invalid request body" }));
    }
    return decoded.success;
  });

const doJson = <T>(stub: Stub, path: string, init: RequestInit, member: WorldMember) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers);
    headers.set("x-ttrpg-member-id", member.id);
    headers.set("x-ttrpg-member-name", member.displayName);
    headers.set("x-ttrpg-role", member.role);
    const response = yield* Effect.promise(() =>
      stub.fetch(new Request(`https://do/internal/${path}`, { ...init, headers })),
    );
    if (!response.ok) {
      const errorBody = yield* Effect.promise(() =>
        response
          .clone()
          .json()
          .then((body) => body as { error?: string })
          .catch(() => ({}) as { error?: string }),
      );
      const message = errorBody.error ?? `World service error (${response.status})`;
      if (response.status === 403) return yield* Effect.fail(new Forbidden({ message }));
      if (response.status === 400) return yield* Effect.fail(new BadRequest({ message }));
      return yield* Effect.fail(new NotFound({ message }));
    }
    return (yield* Effect.promise(() => response.json())) as T;
  });

const loadWorld = (roles?: MemberRole[]) =>
  Effect.gen(function* () {
    const db = yield* D1;
    const user = yield* requireUser;
    const params = yield* HttpRouter.params;
    const worldId = params.id;
    if (!worldId) return yield* Effect.fail(new NotFound({ message: "World not found" }));
    const world = yield* repo.getWorld(db, worldId);
    if (!world) return yield* Effect.fail(new NotFound({ message: "World not found" }));
    const membership = yield* repo.getMembership(db, worldId, user.id);
    if (!membership) {
      return yield* Effect.fail(new Forbidden({ message: "You are not a member of this world" }));
    }
    const member = repo.toWorldMember(membership);
    if (roles && !roles.includes(member.role)) {
      return yield* Effect.fail(new Forbidden({ message: "You do not have permission" }));
    }
    const namespace = yield* WorldNamespace;
    const stub = namespace.getByName(world.do_name);
    return { db, user, world, member, stub };
  });

const route = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError | HttpServerError, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("Unauthorized", (error) => Effect.succeed(json({ error: error.message }, 401))),
    Effect.catchTag("Forbidden", (error) => Effect.succeed(json({ error: error.message }, 403))),
    Effect.catchTag("NotFound", (error) => Effect.succeed(json({ error: error.message }, 404))),
    Effect.catchTag("BadRequest", (error) => Effect.succeed(json({ error: error.message }, 400))),
    Effect.catchTag("HttpServerError", (error) =>
      Effect.succeed(
        json({ error: (error as { message?: string }).message ?? "Server error" }, 500),
      ),
    ),
  ) as Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>;

const canSeeMessage = (message: ChatMessage, member: WorldMember) => {
  if (message.authorMemberId === member.id) return true;
  if (message.recipientMemberIds.length > 0) {
    return message.recipientMemberIds.includes(member.id) || member.role === "dm";
  }
  if (message.visibility === "public") return true;
  if (message.visibility === "dm") return member.role === "dm";
  return false;
};

const canSeeNote = (note: NoteSummary, member: WorldMember) => {
  if (note.ownerMemberId === member.id) return true;
  if (note.visibility === "public") return true;
  if (note.visibility === "dm") return member.role === "dm";
  return false;
};

const worldSummary = (
  world: { id: string; name: string; slug: string; created_at: string },
  member: WorldMember,
  ownerName: string,
): WorldSummary => ({
  id: world.id,
  name: world.name,
  slug: world.slug,
  role: member.role,
  memberName: member.displayName,
  ownerName,
  createdAt: world.created_at,
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const Me = HttpRouter.route(
  "GET",
  "/api/me",
  route(
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      if (!user) return json({ user: null, worlds: [] });
      const db = yield* D1;
      const worlds = yield* repo.listWorldsForUser(db, user.id);
      return json({ user, worlds: worlds.map(repo.toWorldSummary) });
    }),
  ),
);

const GoogleDev = HttpRouter.route(
  "POST",
  "/api/auth/google",
  route(
    Effect.gen(function* () {
      const input = yield* readBody(DevGoogleInput);
      const db = yield* D1;
      const row = yield* repo.upsertGoogleUser(db, {
        email: input.email,
        displayName: input.displayName,
      });
      yield* repo.linkInvitedMembers(db, input.email, row.id);
      const token = randomToken();
      yield* repo.createSession(db, row.id, token);
      const response = yield* HttpServerResponse.setCookie(
        json({ user: repo.toAuthUser(row) }),
        SESSION_COOKIE,
        token,
        { httpOnly: true, path: "/", sameSite: "lax", maxAge: "30 days" },
      ).pipe(Effect.orDie);
      return response;
    }),
  ),
);

const Login = HttpRouter.route(
  "POST",
  "/api/auth/login",
  route(
    Effect.gen(function* () {
      const input = yield* readBody(LoginInput);
      const db = yield* D1;
      const user = yield* repo.findUserByUsername(db, input.username);
      if (!user || !user.password_hash || !user.password_salt) {
        return yield* Effect.fail(new Unauthorized({ message: "Invalid credentials" }));
      }
      const valid = yield* Effect.promise(() =>
        verifyPassword(input.password, user.password_hash!, user.password_salt!),
      );
      if (!valid) return yield* Effect.fail(new Unauthorized({ message: "Invalid credentials" }));
      const token = randomToken();
      yield* repo.createSession(db, user.id, token);
      return yield* HttpServerResponse.setCookie(
        json({ user: repo.toAuthUser(user) }),
        SESSION_COOKIE,
        token,
        { httpOnly: true, path: "/", sameSite: "lax", maxAge: "30 days" },
      ).pipe(Effect.orDie);
    }),
  ),
);

const Logout = HttpRouter.route(
  "POST",
  "/api/auth/logout",
  route(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const token = request.cookies[SESSION_COOKIE];
      const db = yield* D1;
      if (token) yield* repo.deleteSession(db, token);
      return yield* HttpServerResponse.expireCookie(json({ ok: true }), SESSION_COOKIE, {
        path: "/",
      }).pipe(Effect.orDie);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

const CreateWorld = HttpRouter.route(
  "POST",
  "/api/worlds",
  route(
    Effect.gen(function* () {
      const input = yield* readBody(CreateWorldInput);
      const user = yield* requireUser;
      const db = yield* D1;
      const worldId = yield* repo.createWorld(db, {
        ownerUserId: user.id,
        ownerName: user.displayName,
        name: input.name,
      });
      const world = (yield* repo.getWorld(db, worldId))!;
      const membership = (yield* repo.getMembership(db, worldId, user.id))!;
      const member = repo.toWorldMember(membership);
      return json(worldSummary(world, member, user.displayName), 201);
    }),
  ),
);

const WorldBootstrap = HttpRouter.route(
  "GET",
  "/api/worlds/:id",
  route(
    Effect.gen(function* () {
      const { db, user, world, member, stub } = yield* loadWorld();
      const state = yield* doJson<{
        templates: unknown[];
        characters: unknown[];
        messages: ChatMessage[];
        hasMoreMessages: boolean;
        notes: NoteSummary[];
      }>(stub, "state", { method: "GET" }, member);
      const members = yield* repo.listMembers(db, world.id);
      const owner = yield* repo.findUserById(db, world.owner_user_id);
      return json({
        world: worldSummary(world, member, owner?.display_name ?? user.displayName),
        member,
        members: members.map(repo.toWorldMember),
        templates: state.templates,
        characters: state.characters,
        messages: state.messages.filter((message) => canSeeMessage(message, member)),
        hasMoreMessages: state.hasMoreMessages,
        notes: state.notes.filter((note) => canSeeNote(note, member)),
      });
    }),
  ),
);

const ListMembers = HttpRouter.route(
  "GET",
  "/api/worlds/:id/members",
  route(
    Effect.gen(function* () {
      const { db, world } = yield* loadWorld();
      const members = yield* repo.listMembers(db, world.id);
      return json(members.map(repo.toWorldMember));
    }),
  ),
);

const CreateMember = HttpRouter.route(
  "POST",
  "/api/worlds/:id/members",
  route(
    Effect.gen(function* () {
      const { db, user, world } = yield* loadWorld(["dm"]);
      const input = yield* readBody(CreateMemberInput);
      let userId: string | undefined;
      if (input.kind === "password") {
        if (!input.username || !input.password) {
          return yield* Effect.fail(
            new BadRequest({ message: "A username and password are required" }),
          );
        }
        const { hash, salt } = yield* Effect.promise(() => hashPassword(input.password!));
        userId = yield* repo.createLocalUser(db, {
          displayName: input.displayName,
          username: input.username,
          passwordHash: hash,
          passwordSalt: salt,
          createdBy: user.id,
        });
      }
      const row = yield* repo.createMember(db, {
        worldId: world.id,
        displayName: input.displayName,
        role: input.role,
        kind: input.kind,
        email: input.email,
        username: input.username,
        userId,
      });
      return json(repo.toWorldMember(row), 201);
    }),
  ),
);

const UpdateMember = HttpRouter.route(
  "PATCH",
  "/api/worlds/:id/members/:memberId",
  route(
    Effect.gen(function* () {
      const { db, world } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const memberId = params.memberId;
      if (!memberId) return yield* Effect.fail(new NotFound({ message: "Member not found" }));
      const input = yield* readBody(UpdateMemberInput);
      if (input.password) {
        const target = yield* repo.getMember(db, world.id, memberId);
        if (!target?.user_id) {
          return yield* Effect.fail(
            new BadRequest({ message: "This member has no password account" }),
          );
        }
        const { hash, salt } = yield* Effect.promise(() => hashPassword(input.password!));
        yield* repo.setUserPassword(db, target.user_id, hash, salt);
      }
      const row = yield* repo.updateMember(db, {
        worldId: world.id,
        memberId,
        displayName: input.displayName,
        role: input.role,
        characterId: input.characterId,
      });
      return json(repo.toWorldMember(row));
    }),
  ),
);

const DeleteMember = HttpRouter.route(
  "DELETE",
  "/api/worlds/:id/members/:memberId",
  route(
    Effect.gen(function* () {
      const { db, world } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const memberId = params.memberId;
      if (!memberId) return yield* Effect.fail(new NotFound({ message: "Member not found" }));
      const target = yield* repo.getMember(db, world.id, memberId);
      if (!target) return yield* Effect.fail(new NotFound({ message: "Member not found" }));
      if (target.kind === "owner") {
        return yield* Effect.fail(new BadRequest({ message: "The owner cannot be removed" }));
      }
      yield* repo.deleteMember(db, world.id, memberId);
      return json({ ok: true });
    }),
  ),
);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const ListTemplates = HttpRouter.route(
  "GET",
  "/api/worlds/:id/templates",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      return json(
        yield* doJson(stub, "state", { method: "GET" }, member).pipe(
          Effect.map((s: any) => s.templates),
        ),
      );
    }),
  ),
);

const SaveTemplate = HttpRouter.route(
  "POST",
  "/api/worlds/:id/templates",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const input = yield* readBody(SaveTemplateInput);
      const template = yield* doJson(
        stub,
        "template",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        member,
      );
      return json(template);
    }),
  ),
);

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const ListCharacters = HttpRouter.route(
  "GET",
  "/api/worlds/:id/characters",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      return json(
        yield* doJson(stub, "state", { method: "GET" }, member).pipe(
          Effect.map((s: any) => s.characters),
        ),
      );
    }),
  ),
);

const SaveCharacter = HttpRouter.route(
  "POST",
  "/api/worlds/:id/characters",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const input = yield* readBody(SaveCharacterInput);
      const character = yield* doJson(
        stub,
        "character",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...input,
            memberId: member.role === "dm" ? (input.memberId ?? member.id) : member.id,
          }),
        },
        member,
      );
      return json(character);
    }),
  ),
);

const DeleteCharacter = HttpRouter.route(
  "DELETE",
  "/api/worlds/:id/characters/:characterId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const characterId = params.characterId;
      if (!characterId) return yield* Effect.fail(new NotFound({ message: "Character not found" }));
      yield* doJson(stub, `character/${characterId}`, { method: "DELETE" }, member);
      return json({ ok: true });
    }),
  ),
);

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const UploadAvatar = HttpRouter.route(
  "POST",
  "/api/worlds/:id/characters/:characterId/avatar",
  route(
    Effect.gen(function* () {
      const { world, member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const characterId = params.characterId;
      if (!characterId) return yield* Effect.fail(new NotFound({ message: "Character not found" }));
      const request = yield* HttpServerRequest.HttpServerRequest;
      const character = yield* doJson<{ memberId: string }>(
        stub,
        `character/${characterId}`,
        { method: "GET" },
        member,
      );
      if (member.role !== "dm" && character.memberId !== member.id) {
        return yield* Effect.fail(new Forbidden({ message: "You cannot edit this character" }));
      }
      const contentType = (request.headers["content-type"] ?? "").split(";")[0].trim();
      const extension = ALLOWED_AVATAR_TYPES[contentType];
      if (!extension) {
        return yield* Effect.fail(
          new BadRequest({ message: "Avatar must be a PNG, JPEG, WebP, or GIF" }),
        );
      }
      const bytes = yield* request.arrayBuffer;
      if (bytes.byteLength > MAX_AVATAR_BYTES) {
        return yield* Effect.fail(new BadRequest({ message: "Avatar must be 5MB or smaller" }));
      }
      const key = `${world.r2_prefix}/avatars/${characterId}-${Date.now()}.${extension}`;
      const bucket = yield* Bucket;
      yield* Effect.promise(() => bucket.put(key, bytes, { httpMetadata: { contentType } }));
      const updated = yield* doJson(
        stub,
        "character/avatar",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ characterId, avatarKey: key }),
        },
        member,
      );
      return json(updated);
    }),
  ),
);

const GetAvatar = HttpRouter.route(
  "GET",
  "/api/worlds/:id/characters/:characterId/avatar",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const characterId = params.characterId;
      if (!characterId) return yield* Effect.fail(new NotFound({ message: "Character not found" }));
      const character = yield* doJson<{ avatarKey?: string }>(
        stub,
        `character/${characterId}`,
        { method: "GET" },
        member,
      );
      if (!character.avatarKey) {
        return yield* Effect.fail(new NotFound({ message: "This character has no picture" }));
      }
      const bucket = yield* Bucket;
      const object = yield* Effect.promise(() => bucket.get(character.avatarKey!));
      if (!object) return yield* Effect.fail(new NotFound({ message: "Picture not found" }));
      const contentType = object.httpMetadata?.contentType ?? "image/png";
      const bytes = yield* Effect.promise(() => object.bytes());
      return HttpServerResponse.uint8Array(bytes, {
        contentType,
        headers: { "cache-control": "private, max-age=31536000, immutable" },
      });
    }),
  ),
);

// ---------------------------------------------------------------------------
// Messages (paginated)
// ---------------------------------------------------------------------------

const ListMessages = HttpRouter.route(
  "GET",
  "/api/worlds/:id/messages",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://localhost");
      const query = new URLSearchParams();
      const before = url.searchParams.get("before");
      const beforeId = url.searchParams.get("beforeId");
      const limit = url.searchParams.get("limit");
      if (before) query.set("before", before);
      if (beforeId) query.set("beforeId", beforeId);
      if (limit) query.set("limit", limit);
      const page = yield* doJson<{ messages: ChatMessage[]; hasMore: boolean }>(
        stub,
        `messages${query.size ? `?${query.toString()}` : ""}`,
        { method: "GET" },
        member,
      );
      return json({
        messages: page.messages.filter((message) => canSeeMessage(message, member)),
        hasMore: page.hasMore,
      });
    }),
  ),
);

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const ListNotes = HttpRouter.route(
  "GET",
  "/api/worlds/:id/notes",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const notes = yield* doJson<NoteSummary[]>(stub, "notes", { method: "GET" }, member);
      return json(notes.filter((note) => canSeeNote(note, member)));
    }),
  ),
);

const GetNote = HttpRouter.route(
  "GET",
  "/api/worlds/:id/notes/:noteId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const noteId = params.noteId;
      if (!noteId) return yield* Effect.fail(new NotFound({ message: "Note not found" }));
      const note = yield* doJson<Note>(stub, `notes/${noteId}`, { method: "GET" }, member);
      if (!canSeeNote(note, member)) {
        return yield* Effect.fail(new Forbidden({ message: "You cannot view this note" }));
      }
      return json(note);
    }),
  ),
);

const SaveNote = HttpRouter.route(
  "PUT",
  "/api/worlds/:id/notes/:noteId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const noteId = params.noteId;
      if (!noteId) return yield* Effect.fail(new NotFound({ message: "Note not found" }));
      const input = yield* readBody(SaveNoteInput);
      const note = yield* doJson<Note>(
        stub,
        "note",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...input, id: noteId, ownerMemberId: member.id }),
        },
        member,
      );
      return json(note);
    }),
  ),
);

const DeleteNote = HttpRouter.route(
  "DELETE",
  "/api/worlds/:id/notes/:noteId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const noteId = params.noteId;
      if (!noteId) return yield* Effect.fail(new NotFound({ message: "Note not found" }));
      yield* doJson(stub, `notes/${noteId}`, { method: "DELETE" }, member);
      return json({ ok: true });
    }),
  ),
);

export const Api = HttpRouter.addAll([
  Me,
  GoogleDev,
  Login,
  Logout,
  CreateWorld,
  WorldBootstrap,
  ListMembers,
  CreateMember,
  UpdateMember,
  DeleteMember,
  ListTemplates,
  SaveTemplate,
  ListCharacters,
  SaveCharacter,
  DeleteCharacter,
  UploadAvatar,
  GetAvatar,
  ListMessages,
  ListNotes,
  GetNote,
  SaveNote,
  DeleteNote,
]);

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
