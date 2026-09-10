import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["google", "local"] }).notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    username: text("username"),
    googleSub: text("google_sub"),
    avatarUrl: text("avatar_url"),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_email_uniq")
      .on(table.email)
      .where(sql`${table.email} IS NOT NULL`),
    uniqueIndex("users_username_uniq")
      .on(table.username)
      .where(sql`${table.username} IS NOT NULL`),
  ],
);

export const worlds = sqliteTable(
  "worlds",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    doName: text("do_name").notNull(),
    r2Prefix: text("r2_prefix").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("worlds_slug_uniq").on(table.slug),
    index("worlds_owner_idx").on(table.ownerUserId),
  ],
);

export const worldMembers = sqliteTable(
  "world_members",
  {
    id: text("id").primaryKey(),
    worldId: text("world_id").notNull(),
    userId: text("user_id"),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["dm", "player"] }).notNull(),
    kind: text("kind", { enum: ["owner", "invite", "password"] }).notNull(),
    email: text("email"),
    username: text("username"),
    characterId: text("character_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("world_members_world_idx").on(table.worldId),
    index("world_members_user_idx").on(table.userId),
    index("world_members_email_idx").on(table.email),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type WorldRow = typeof worlds.$inferSelect;
export type WorldMemberRow = typeof worldMembers.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
