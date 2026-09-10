import * as Effect from "effect/Effect";
import type {
  AuthUser,
  MemberKind,
  MemberRole,
  WorldMember,
  WorldSummary,
} from "../domain/schemas";
import { newId, nowIso, slugify } from "./crypto";
import { BadRequest, NotFound } from "./services";

type Queryable = Pick<D1Database, "prepare">;

const all = <T>(db: Queryable, sql: string, ...bindings: unknown[]) =>
  Effect.promise(async () => {
    const { results } = await db
      .prepare(sql)
      .bind(...bindings)
      .all<T>();
    return results ?? [];
  });

const first = <T>(db: Queryable, sql: string, ...bindings: unknown[]) =>
  Effect.promise(
    async () =>
      (await db
        .prepare(sql)
        .bind(...bindings)
        .first<T>()) ?? null,
  );

const run = (db: Queryable, sql: string, ...bindings: unknown[]) =>
  Effect.promise(async () => {
    await db
      .prepare(sql)
      .bind(...bindings)
      .run();
  });

type UserRow = {
  id: string;
  kind: "google" | "local";
  display_name: string;
  email: string | null;
  google_sub: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  password_salt: string | null;
  created_by: string | null;
  created_at: string;
};

type WorldRow = {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  do_name: string;
  r2_prefix: string;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  id: string;
  world_id: string;
  user_id: string | null;
  display_name: string;
  role: MemberRole;
  kind: MemberKind;
  email: string | null;
  username: string | null;
  character_id: string | null;
  created_at: string;
};

export const toAuthUser = (row: UserRow): AuthUser => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email ?? undefined,
  avatarUrl: row.avatar_url ?? undefined,
  kind: row.kind,
});

export const toWorldMember = (row: MemberRow): WorldMember => ({
  id: row.id,
  worldId: row.world_id,
  displayName: row.display_name,
  role: row.role,
  kind: row.kind,
  email: row.email ?? undefined,
  username: row.username ?? undefined,
  characterId: row.character_id ?? undefined,
  createdAt: row.created_at,
});

export const findUserByEmail = (db: Queryable, email: string) =>
  first<UserRow>(db, "SELECT * FROM users WHERE email = ? LIMIT 1", email.toLowerCase());

export const findUserByUsername = (db: Queryable, username: string) =>
  first<UserRow>(db, "SELECT * FROM users WHERE username = ? LIMIT 1", username.toLowerCase());

export const findUserById = (db: Queryable, id: string) =>
  first<UserRow>(db, "SELECT * FROM users WHERE id = ? LIMIT 1", id);

export const getUserPassword = (db: Queryable, id: string) =>
  first<{ password_hash: string | null; password_salt: string | null }>(
    db,
    "SELECT password_hash, password_salt FROM users WHERE id = ? LIMIT 1",
    id,
  );

export const upsertGoogleUser = (
  db: Queryable,
  input: { email: string; displayName?: string; avatarUrl?: string },
) =>
  Effect.gen(function* () {
    const email = input.email.toLowerCase();
    const existing = yield* findUserByEmail(db, email);
    if (existing) {
      const name = input.displayName ?? existing.display_name;
      yield* run(db, "UPDATE users SET display_name = ? WHERE id = ?", name, existing.id);
      return { ...existing, display_name: name };
    }
    const id = newId("usr");
    const now = nowIso();
    const displayName = input.displayName ?? email.split("@")[0];
    yield* run(
      db,
      "INSERT INTO users (id, kind, display_name, email, google_sub, avatar_url, created_at) VALUES (?, 'google', ?, ?, ?, ?, ?)",
      id,
      displayName,
      email,
      `dev:${email}`,
      input.avatarUrl ?? null,
      now,
    );
    return {
      id,
      kind: "google" as const,
      display_name: displayName,
      email,
      google_sub: `dev:${email}`,
      avatar_url: input.avatarUrl ?? null,
      password_hash: null,
      password_salt: null,
      created_by: null,
      created_at: now,
    };
  });

export const createLocalUser = (
  db: Queryable,
  input: {
    displayName: string;
    username: string;
    passwordHash: string;
    passwordSalt: string;
    createdBy: string;
  },
) =>
  Effect.gen(function* () {
    const username = input.username.toLowerCase();
    const clash = yield* findUserByUsername(db, username);
    if (clash) return yield* Effect.fail(new BadRequest({ message: "Username already taken" }));
    const id = newId("usr");
    const now = nowIso();
    yield* run(
      db,
      "INSERT INTO users (id, kind, display_name, username, password_hash, password_salt, created_by, created_at) VALUES (?, 'local', ?, ?, ?, ?, ?, ?)",
      id,
      input.displayName,
      username,
      input.passwordHash,
      input.passwordSalt,
      input.createdBy,
      now,
    );
    return id;
  });

export const setUserPassword = (
  db: Queryable,
  userId: string,
  passwordHash: string,
  passwordSalt: string,
) =>
  Effect.gen(function* () {
    yield* run(
      db,
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
      passwordHash,
      passwordSalt,
      userId,
    );
  });

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const createSession = (db: Queryable, userId: string, token: string) =>
  Effect.gen(function* () {
    const now = nowIso();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    yield* run(
      db,
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      token,
      userId,
      now,
      expires,
    );
  });

export const getSessionUser = (db: Queryable, token: string) =>
  Effect.gen(function* () {
    const row = yield* first<{ user_id: string; expires_at: string }>(
      db,
      "SELECT user_id, expires_at FROM sessions WHERE token = ? LIMIT 1",
      token,
    );
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      yield* run(db, "DELETE FROM sessions WHERE token = ?", token);
      return null;
    }
    const user = yield* findUserById(db, row.user_id);
    return user;
  });

export const deleteSession = (db: Queryable, token: string) =>
  run(db, "DELETE FROM sessions WHERE token = ?", token);

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

export const linkInvitedMembers = (db: Queryable, email: string, userId: string) =>
  run(
    db,
    "UPDATE world_members SET user_id = ? WHERE email = ? AND user_id IS NULL",
    userId,
    email.toLowerCase(),
  );

export const createWorld = (
  db: Queryable,
  input: { ownerUserId: string; ownerName: string; name: string },
) =>
  Effect.gen(function* () {
    const name = input.name.trim();
    if (!name) return yield* Effect.fail(new BadRequest({ message: "World name is required" }));
    const id = newId("wld");
    const now = nowIso();
    let slug = slugify(name);
    const existing = yield* first<{ n: number }>(
      db,
      "SELECT COUNT(*) as n FROM worlds WHERE slug = ?",
      slug,
    );
    if (existing && existing.n > 0) slug = `${slug}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const doName = `world:${id}`;
    const r2Prefix = `world/${id}`;
    yield* run(
      db,
      "INSERT INTO worlds (id, owner_user_id, name, slug, do_name, r2_prefix, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.ownerUserId,
      name,
      slug,
      doName,
      r2Prefix,
      now,
      now,
    );
    yield* run(
      db,
      "INSERT INTO world_members (id, world_id, user_id, display_name, role, kind, created_at) VALUES (?, ?, ?, ?, 'dm', 'owner', ?)",
      newId("mem"),
      id,
      input.ownerUserId,
      input.ownerName,
      now,
    );
    return id;
  });

export const getWorld = (db: Queryable, id: string) =>
  first<WorldRow>(db, "SELECT * FROM worlds WHERE id = ? LIMIT 1", id);

export const getMembership = (db: Queryable, worldId: string, userId: string) =>
  first<MemberRow>(
    db,
    "SELECT * FROM world_members WHERE world_id = ? AND user_id = ? LIMIT 1",
    worldId,
    userId,
  );

export const listWorldsForUser = (db: Queryable, userId: string) =>
  all<{
    id: string;
    name: string;
    slug: string;
    role: MemberRole;
    member_name: string;
    owner_name: string;
    created_at: string;
  }>(
    db,
    `SELECT w.id, w.name, w.slug, m.role, m.display_name AS member_name, owner.display_name AS owner_name, w.created_at
     FROM worlds w
     JOIN world_members m ON m.world_id = w.id AND m.user_id = ?
     JOIN users owner ON owner.id = w.owner_user_id
     ORDER BY w.created_at DESC`,
    userId,
  );

export const toWorldSummary = (row: {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
  member_name: string;
  owner_name: string;
  created_at: string;
}): WorldSummary => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  role: row.role,
  memberName: row.member_name,
  ownerName: row.owner_name,
  createdAt: row.created_at,
});

export const listMembers = (db: Queryable, worldId: string) =>
  all<MemberRow>(
    db,
    "SELECT * FROM world_members WHERE world_id = ? ORDER BY created_at ASC",
    worldId,
  );

export const getMember = (db: Queryable, worldId: string, memberId: string) =>
  first<MemberRow>(
    db,
    "SELECT * FROM world_members WHERE world_id = ? AND id = ? LIMIT 1",
    worldId,
    memberId,
  );

export const createMember = (
  db: Queryable,
  input: {
    worldId: string;
    displayName: string;
    role: MemberRole;
    kind: MemberKind;
    email?: string;
    username?: string;
    userId?: string;
  },
) =>
  Effect.gen(function* () {
    if (input.kind === "invite" && !input.email) {
      return yield* Effect.fail(new BadRequest({ message: "An invite needs an email" }));
    }
    const id = newId("mem");
    yield* run(
      db,
      "INSERT INTO world_members (id, world_id, user_id, display_name, role, kind, email, username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.worldId,
      input.userId ?? null,
      input.displayName,
      input.role,
      input.kind,
      input.email?.toLowerCase() ?? null,
      input.username?.toLowerCase() ?? null,
      nowIso(),
    );
    const row = yield* getMember(db, input.worldId, id);
    return row!;
  });

export const updateMember = (
  db: Queryable,
  input: {
    worldId: string;
    memberId: string;
    displayName?: string;
    role?: MemberRole;
    characterId?: string | null;
  },
) =>
  Effect.gen(function* () {
    const existing = yield* getMember(db, input.worldId, input.memberId);
    if (!existing) return yield* Effect.fail(new NotFound({ message: "Member not found" }));
    yield* run(
      db,
      "UPDATE world_members SET display_name = COALESCE(?, display_name), role = COALESCE(?, role), character_id = CASE WHEN ? THEN ? ELSE character_id END WHERE id = ?",
      input.displayName ?? null,
      input.role ?? null,
      input.characterId === undefined ? 0 : 1,
      input.characterId ?? null,
      input.memberId,
    );
    return (yield* getMember(db, input.worldId, input.memberId))!;
  });

export const deleteMember = (db: Queryable, worldId: string, memberId: string) =>
  run(db, "DELETE FROM world_members WHERE world_id = ? AND id = ?", worldId, memberId);
