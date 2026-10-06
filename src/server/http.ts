import { fromReply } from "./reply";
import type { WorldDO } from "./world-do";
import type { Caller } from "./world-rpc";
import {
  ImportedWorld,
  SaveWorldCharacterInput,
  SaveWorldTemplateInput,
  inputMessage,
} from "./world-do";
import { canEditCharacter } from "./world-do";
import { CorpusRoutes } from "./corpus-http";
import { EnableSourceInput } from "../domain/corpus-rpc";
import { SaveOverrideInput } from "../domain/overrides";
import { canSeeNote } from "../domain/note-permissions";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CompendiumPack,
  EntryBodiesInput,
  EntryType,
  SaveEntryInput,
  compendiumLimits,
} from "../domain/compendium";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { HttpServerError } from "effect/unstable/http/HttpServerError";
import {
  CreateMemberInput,
  CreateWorldInput,
  DevGoogleInput,
  LoginInput,
  SaveNoteInput,
  UpdateMemberInput,
  type ChatMessage,
  type MemberRole,
  type WorldMember,
  type WorldSummary,
} from "../domain/schemas";
import {
  BoardAssetId,
  PublishBoardInput,
  CreateSceneInput,
  UpdateSceneInput,
} from "../domain/board";
import { AVATAR_EXTENSIONS, uploadRules } from "../domain/uploads";
import {
  ExportFilePath,
  MAX_WORLD_EXPORT_BYTES,
  WORLD_EXPORT_FORMAT,
  WORLD_EXPORT_VERSION,
  type WorldExport,
} from "../domain/world-export";
import { hashPassword, randomToken, verifyPassword } from "./crypto";
import * as repo from "./db";
import {
  BadRequest,
  Bucket,
  CurrentUser,
  Features,
  D1,
  Forbidden,
  NotFound,
  Unavailable,
  Unauthorized,
  WorldNamespace,
  requireUser,
  type ApiError,
} from "./services";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const SESSION_COOKIE = "ttrpg_session";

const caller = (member: WorldMember): Caller => ({
  memberId: member.id,
  displayName: member.displayName,
  role: member.role,
});

const bindingIO = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(Effect.fail(new Unavailable({ message: "World service unavailable" }))),
      ),
    ),
  );

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
      return yield* Effect.fail(
        new BadRequest({ message: inputMessage(decoded.failure, "Invalid request body") }),
      );
    }
    return decoded.success;
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
    const stub = (namespace as DurableObjectNamespace<WorldDO>).getByName(world.do_name);
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
    Effect.catchTag("Conflict", (error) => Effect.succeed(json({ error: error.message }, 409))),
    Effect.catchTag("Unavailable", (error) => Effect.succeed(json({ error: error.message }, 503))),
    Effect.catchTag("HttpServerError", (error) =>
      Effect.succeed(
        json({ error: (error as { message?: string }).message ?? "Server error" }, 500),
      ),
    ),
  );

const canSeeMessage = (message: ChatMessage, member: WorldMember) => {
  if (message.authorMemberId === member.id) return true;
  if (message.recipientMemberIds.length > 0) {
    return message.recipientMemberIds.includes(member.id) || member.role === "dm";
  }
  if (message.visibility === "public") return true;
  if (message.visibility === "dm") return member.role === "dm";
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
        {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          maxAge: "30 days",
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
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
      const valid = yield* bindingIO(() =>
        verifyPassword(input.password, user.password_hash!, user.password_salt!),
      );
      if (!valid) return yield* Effect.fail(new Unauthorized({ message: "Invalid credentials" }));
      const token = randomToken();
      yield* repo.createSession(db, user.id, token);
      return yield* HttpServerResponse.setCookie(
        json({ user: repo.toAuthUser(user) }),
        SESSION_COOKIE,
        token,
        {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          maxAge: "30 days",
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
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
      const state = yield* fromReply(() => stub.state(caller(member)));
      const members = yield* repo.listMembers(db, world.id);
      const owner = yield* repo.findUserById(db, world.owner_user_id);
      return json({
        world: worldSummary(world, member, owner?.display_name ?? user.displayName),
        features: yield* Features,
        member,
        members: members.map(repo.toWorldMember),
        board: state.board,
        ...(member.role === "dm"
          ? {
              scenes: state.scenes,
              activeSceneId: state.activeSceneId,
              importPending: state.importPending,
            }
          : {}),
        templates: state.templates,
        characters: state.characters,
        messages: state.messages.filter((message) => canSeeMessage(message, member)),
        hasMoreMessages: state.hasMoreMessages,
        notes: state.notes.filter((note) => canSeeNote(note, member)),
      });
    }),
  ),
);

const GetBoard = HttpRouter.route(
  "GET",
  "/api/worlds/:id/board",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      return json(yield* fromReply(() => stub.board(caller(member))));
    }),
  ),
);

const PublishBoard = HttpRouter.route(
  "PUT",
  "/api/worlds/:id/board",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const input = yield* readBody(PublishBoardInput);
      return json(yield* fromReply(() => stub.publishBoard(caller(member), input)));
    }),
  ),
);

const ListScenes = HttpRouter.route(
  "GET",
  "/api/worlds/:id/scenes",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      return json(yield* fromReply(() => stub.scenes(caller(member))));
    }),
  ),
);

const CreateScene = HttpRouter.route(
  "POST",
  "/api/worlds/:id/scenes",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const input = yield* readBody(CreateSceneInput);
      return json(yield* fromReply(() => stub.createScene(caller(member), input)), 201);
    }),
  ),
);

const GetScene = HttpRouter.route(
  "GET",
  "/api/worlds/:id/scenes/:sceneId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.sceneId);
      if (decoded._tag === "Failure") return yield* new BadRequest({ message: "Invalid scene id" });
      return json(yield* fromReply(() => stub.scene(caller(member), decoded.success)));
    }),
  ),
);

const PublishScene = HttpRouter.route(
  "PUT",
  "/api/worlds/:id/scenes/:sceneId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.sceneId);
      if (decoded._tag === "Failure") return yield* new BadRequest({ message: "Invalid scene id" });
      const input = yield* readBody(PublishBoardInput);
      return json(
        yield* fromReply(() => stub.publishScene(caller(member), decoded.success, input)),
      );
    }),
  ),
);

const UpdateScene = HttpRouter.route(
  "PATCH",
  "/api/worlds/:id/scenes/:sceneId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.sceneId);
      if (decoded._tag === "Failure") return yield* new BadRequest({ message: "Invalid scene id" });
      const input = yield* readBody(UpdateSceneInput);
      return json(yield* fromReply(() => stub.updateScene(caller(member), decoded.success, input)));
    }),
  ),
);

const DeleteScene = HttpRouter.route(
  "DELETE",
  "/api/worlds/:id/scenes/:sceneId",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.sceneId);
      if (decoded._tag === "Failure") return yield* new BadRequest({ message: "Invalid scene id" });
      return json(yield* fromReply(() => stub.deleteScene(caller(member), decoded.success)));
    }),
  ),
);

const ActivateScene = HttpRouter.route(
  "POST",
  "/api/worlds/:id/scenes/:sceneId/active",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.sceneId);
      if (decoded._tag === "Failure") return yield* new BadRequest({ message: "Invalid scene id" });
      return json(yield* fromReply(() => stub.activateScene(caller(member), decoded.success)));
    }),
  ),
);

const UploadBoardImage = HttpRouter.route(
  "POST",
  "/api/worlds/:id/board/images",
  route(
    Effect.gen(function* () {
      const { world } = yield* loadWorld(["dm"]);
      const request = yield* HttpServerRequest.HttpServerRequest;
      const contentType = request.headers["content-type"] ?? "";
      const rules = uploadRules.board;
      if (!(rules.types as readonly string[]).includes(contentType)) {
        return yield* Effect.fail(new BadRequest({ message: rules.typeMessage }));
      }
      // Consume incrementally so an oversized upload cannot allocate an unbounded buffer.
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.mapError(() => new BadRequest({ message: "Could not read image" })),
      );
      if (!webRequest.body)
        return yield* Effect.fail(new BadRequest({ message: "Image is empty" }));
      const reader = webRequest.body.getReader();
      const bytes = yield* Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: () => new BadRequest({ message: "Could not read image" }),
          });
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > rules.maxBytes) {
            yield* bindingIO(() => reader.cancel());
            return yield* new BadRequest({ message: rules.sizeMessage });
          }
          chunks.push(chunk.value);
        }
        if (!size) return yield* new BadRequest({ message: "Image is empty" });
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      }).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock())));
      const assetId = crypto.randomUUID();
      const bucket = yield* Bucket;
      yield* bindingIO(() =>
        bucket.put(`${world.r2_prefix}/board/${assetId}`, bytes, { httpMetadata: { contentType } }),
      );
      return json({ assetId }, 201);
    }),
  ),
);

const GetBoardImage = HttpRouter.route(
  "GET",
  "/api/worlds/:id/board/images/:assetId",
  route(
    Effect.gen(function* () {
      const { world } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      const decoded = Schema.decodeUnknownResult(BoardAssetId)(params.assetId);
      if (decoded._tag === "Failure")
        return yield* Effect.fail(new BadRequest({ message: "Invalid image ID" }));
      const bucket = yield* Bucket;
      const object = yield* bindingIO(() =>
        bucket.get(`${world.r2_prefix}/board/${decoded.success}`),
      );
      if (!object) return yield* Effect.fail(new NotFound({ message: "Image not found" }));
      return HttpServerResponse.raw(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "image/webp",
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
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
        const { hash, salt } = yield* bindingIO(() => hashPassword(input.password!));
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
        const { hash, salt } = yield* bindingIO(() => hashPassword(input.password!));
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
        yield* fromReply(() => stub.state(caller(member))).pipe(
          Effect.map((state) => state.templates),
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
      const input = yield* readBody(SaveWorldTemplateInput);
      const template = yield* fromReply(() => stub.saveTemplate(caller(member), input));
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
      const state = yield* fromReply(() => stub.state(caller(member)));
      return json(state.characters);
    }),
  ),
);

const SaveCharacter = HttpRouter.route(
  "POST",
  "/api/worlds/:id/characters",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const input = yield* readBody(SaveWorldCharacterInput);
      const character = yield* fromReply(() => stub.saveCharacter(caller(member), input));
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
      yield* fromReply(() => stub.deleteCharacter(caller(member), characterId));
      return json({ ok: true });
    }),
  ),
);

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
      const character = yield* fromReply(() => stub.character(caller(member), characterId));
      if (!canEditCharacter(character, member.id, member.role)) {
        return yield* Effect.fail(new Forbidden({ message: "You cannot edit this character" }));
      }
      const contentType = (request.headers["content-type"] ?? "").split(";")[0].trim();
      const extension = AVATAR_EXTENSIONS[contentType];
      if (!extension) {
        return yield* Effect.fail(new BadRequest({ message: uploadRules.avatars.typeMessage }));
      }
      const bytes = yield* request.arrayBuffer;
      if (bytes.byteLength > uploadRules.avatars.maxBytes) {
        return yield* Effect.fail(new BadRequest({ message: uploadRules.avatars.sizeMessage }));
      }
      const key = `${world.r2_prefix}/avatars/${characterId}-${Date.now()}.${extension}`;
      const bucket = yield* Bucket;
      yield* bindingIO(() => bucket.put(key, bytes, { httpMetadata: { contentType } }));
      // A DM can lock the sheet during the upload; the DO checks permission again.
      const updated = yield* fromReply(() =>
        stub.setAvatar(caller(member), { characterId, avatarKey: key }),
      );
      return json(updated);
    }),
  ),
);

const DeleteAvatar = HttpRouter.route(
  "DELETE",
  "/api/worlds/:id/characters/:characterId/avatar",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld();
      const params = yield* HttpRouter.params;
      if (!params.characterId)
        return yield* Effect.fail(new NotFound({ message: "Character not found" }));
      const characterId = params.characterId;
      const character = yield* fromReply(() => stub.character(caller(member), characterId));
      const updated = yield* fromReply(() =>
        stub.setAvatar(caller(member), { characterId, avatarKey: null }),
      );
      const avatarKey = character.avatarKey;
      if (avatarKey) {
        const bucket = yield* Bucket;
        yield* bindingIO(() => bucket.delete(avatarKey));
      }
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
      const character = yield* fromReply(() => stub.character(caller(member), characterId));
      if (!character.avatarKey) {
        return yield* Effect.fail(new NotFound({ message: "This character has no picture" }));
      }
      const bucket = yield* Bucket;
      const avatarKey = character.avatarKey;
      const object = yield* bindingIO(() => bucket.get(avatarKey));
      if (!object) return yield* Effect.fail(new NotFound({ message: "Picture not found" }));
      const contentType = object.httpMetadata?.contentType ?? "image/png";
      const bytes = yield* bindingIO(() => object.bytes());
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
      const before = url.searchParams.get("before");
      const beforeId = url.searchParams.get("beforeId");
      const rawLimit = Number(url.searchParams.get("limit") ?? 50);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 100) : 50;
      const page = yield* fromReply(() =>
        stub.messages(caller(member), {
          limit,
          beforeCreatedAt: before ?? undefined,
          beforeId: beforeId ?? undefined,
        }),
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
      const notes = yield* fromReply(() => stub.notes(caller(member)));
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
      const note = yield* fromReply(() => stub.note(caller(member), noteId));
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
      const note = yield* fromReply(() => stub.saveNote(caller(member), { ...input, id: noteId }));
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
      yield* fromReply(() => stub.deleteNote(caller(member), noteId));
      return json({ ok: true });
    }),
  ),
);

// ---------------------------------------------------------------------------
// Export and import (docs/world-export.md)
// ---------------------------------------------------------------------------

const ExportWorld = HttpRouter.route(
  "GET",
  "/api/worlds/:id/export",
  route(
    Effect.gen(function* () {
      const { db, world, member, stub } = yield* loadWorld(["dm"]);
      const request = yield* HttpServerRequest.HttpServerRequest;
      const chat = new URL(request.url, "http://localhost").searchParams.get("chat") !== "0";
      const contents = yield* fromReply(() =>
        stub.exportWorld(caller(member), { chat, worldName: world.name }),
      );
      const members = yield* repo.listMembers(db, world.id);
      const data: WorldExport = {
        format: WORLD_EXPORT_FORMAT,
        version: WORLD_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: member.id,
        world: { name: world.name },
        members: members.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          role: row.role,
        })),
        ...contents,
      };
      return json(data);
    }),
  ),
);

const exportFilePath = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const decoded = Schema.decodeUnknownResult(ExportFilePath)(`${params.kind}/${params.name}`);
  if (decoded._tag === "Failure") return yield* new NotFound({ message: "File not found" });
  return decoded.success;
});

const ExportWorldFile = HttpRouter.route(
  "GET",
  "/api/worlds/:id/export/files/:kind/:name",
  route(
    Effect.gen(function* () {
      const { world } = yield* loadWorld(["dm"]);
      const path = yield* exportFilePath;
      const bucket = yield* Bucket;
      const object = yield* bindingIO(() => bucket.get(`${world.r2_prefix}/${path}`));
      if (!object) return yield* new NotFound({ message: "File not found" });
      return HttpServerResponse.raw(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }),
  ),
);

const ImportWorld = HttpRouter.route(
  "POST",
  "/api/worlds/import",
  route(
    Effect.gen(function* () {
      const user = yield* requireUser;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const text = yield* request.text;
      if (new TextEncoder().encode(text).byteLength > MAX_WORLD_EXPORT_BYTES)
        return yield* new BadRequest({ message: "A world file must be at most 30 MB" });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return yield* new BadRequest({ message: "This isn't a world file" });
      }
      const decoded = Schema.decodeUnknownResult(ImportedWorld)(parsed);
      if (decoded._tag === "Failure")
        return yield* new BadRequest({
          message: inputMessage(decoded.failure, "This isn't a world file this app can read"),
        });
      const data = decoded.success;
      const db = yield* D1;
      const worldId = yield* repo.createWorld(db, {
        ownerUserId: user.id,
        ownerName: user.displayName,
        name: data.world.name,
      });
      const world = (yield* repo.getWorld(db, worldId))!;
      const member = repo.toWorldMember((yield* repo.getMembership(db, worldId, user.id))!);
      const namespace = yield* WorldNamespace;
      const stub = (namespace as DurableObjectNamespace<WorldDO>).getByName(world.do_name);
      // A world that failed to import is removed rather than left half-filled.
      const status = yield* fromReply(() =>
        stub.importWorld(caller(member), data, { worldName: world.name, accountId: user.id }),
      ).pipe(Effect.tapError(() => repo.deleteWorld(db, worldId).pipe(Effect.ignore)));
      return json({ world: worldSummary(world, member, user.displayName), status }, 201);
    }),
  ),
);

const ImportWorldFile = HttpRouter.route(
  "PUT",
  "/api/worlds/:id/import/files/:kind/:name",
  route(
    Effect.gen(function* () {
      const { member, stub } = yield* loadWorld(["dm"]);
      const path = yield* exportFilePath;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const contentType = (request.headers["content-type"] ?? "").split(";")[0].trim();
      const bytes = new Uint8Array(yield* request.arrayBuffer);
      return json(
        yield* fromReply(() => stub.importFile(caller(member), { path, contentType, bytes })),
      );
    }),
  ),
);

// ---------------------------------------------------------------------------
// Compendium
// ---------------------------------------------------------------------------

const compendiumRoute = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  suffix: string,
  schema?: Schema.ConstraintDecoder<unknown>,
  category: "compendium" | "libraries" = "compendium",
) =>
  HttpRouter.route(
    method,
    `/api/worlds/:id/${category}${suffix}`,
    route(
      Effect.gen(function* () {
        const { member, stub, world } = yield* loadWorld(
          category === "compendium" &&
            ((method === "GET" && (suffix === "" || suffix === "/index")) ||
              (method === "POST" && suffix === "/bodies"))
            ? undefined
            : ["dm"],
        );
        const params = yield* HttpRouter.params;
        const path = `${category}${suffix
          .replace(":typeId", encodeURIComponent(params.typeId ?? ""))
          .replace(":entryId", encodeURIComponent(params.entryId ?? ""))
          .replace(":sourceId", encodeURIComponent(params.sourceId ?? ""))}`;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const query = suffix === "/index" ? new URL(request.url, "http://localhost").search : "";
        let body: unknown;
        if (schema) {
          const text = yield* request.text;
          if (
            suffix === "/import" &&
            new TextEncoder().encode(text).byteLength > compendiumLimits.packBytes
          )
            return yield* Effect.fail(
              new BadRequest({ message: "Pack JSON must be at most 4 MB" }),
            );
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return yield* Effect.fail(new BadRequest({ message: "Invalid JSON body" }));
          }
          const decoded = Schema.decodeUnknownResult(
            schema,
            suffix.startsWith("/overrides") ? { onExcessProperty: "error" } : undefined,
          )(parsed);
          if (decoded._tag === "Failure")
            return yield* Effect.fail(new BadRequest({ message: "Invalid compendium data" }));
          body = decoded.success;
        }
        const rpcRequest = {
          method,
          path,
          body,
          query: { since: new URLSearchParams(query).get("since") ?? undefined },
          worldName: world.name,
          accountId: world.owner_user_id,
        };
        const sources =
          category === "libraries" ||
          suffix.startsWith("/overrides") ||
          suffix.startsWith("/blocked");
        const result = yield* fromReply(() =>
          sources
            ? stub.libraries(caller(member), rpcRequest)
            : stub.compendium(caller(member), rpcRequest),
        );
        if (result === undefined) return HttpServerResponse.empty({ status: 204 });
        return json(result);
      }),
    ),
  );

const CompendiumRoutes = [
  compendiumRoute("GET", ""),
  compendiumRoute("GET", "/index"),
  compendiumRoute("POST", "/bodies", EntryBodiesInput),
  compendiumRoute("PUT", "/types/:typeId", EntryType),
  compendiumRoute("DELETE", "/types/:typeId"),
  compendiumRoute("POST", "/entries", SaveEntryInput),
  compendiumRoute("DELETE", "/entries/:entryId"),
  compendiumRoute("GET", "/export"),
  compendiumRoute("POST", "/import", CompendiumPack),
  compendiumRoute("GET", "/overrides/:entryId"),
  compendiumRoute("PUT", "/overrides/:entryId", SaveOverrideInput),
  compendiumRoute("DELETE", "/overrides/:entryId"),
  compendiumRoute("PUT", "/blocked/:entryId"),
  compendiumRoute("DELETE", "/blocked/:entryId"),
  compendiumRoute("GET", "", undefined, "libraries"),
  compendiumRoute("GET", "/blocked", undefined, "libraries"),
  compendiumRoute("GET", "/:sourceId/diff/:entryId", undefined, "libraries"),
  compendiumRoute("PUT", "/:sourceId", EnableSourceInput, "libraries"),
  compendiumRoute("DELETE", "/:sourceId", undefined, "libraries"),
  compendiumRoute("POST", "/check", undefined, "libraries"),
];

export const Api = HttpRouter.addAll([
  ...CorpusRoutes,
  ...CompendiumRoutes,
  Me,
  GoogleDev,
  Login,
  Logout,
  CreateWorld,
  ImportWorld,
  WorldBootstrap,
  ExportWorld,
  ExportWorldFile,
  ImportWorldFile,
  ListScenes,
  CreateScene,
  GetScene,
  PublishScene,
  UpdateScene,
  DeleteScene,
  ActivateScene,
  GetBoard,
  PublishBoard,
  UploadBoardImage,
  GetBoardImage,
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
  DeleteAvatar,
  GetAvatar,
  ListMessages,
  ListNotes,
  GetNote,
  SaveNote,
  DeleteNote,
]);

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
