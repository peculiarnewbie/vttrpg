import { canSeeNote, canSaveNote } from "../domain/note-permissions";
import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";
import { SheetLayout, type ListRow } from "../domain/sheet-layout";
import { notationRefs, parseNotation, rollText, type Parsed } from "../domain/dice-notation";
import { refValues, sheetRefLookup } from "../domain/sheet-refs";
import { layoutLimitsError } from "../domain/template-io";
import { WorldCompendium } from "./world-compendium";
import { WorldSources } from "./world-sources";
import { corpusEnabled, type CorpusBindings } from "./corpus-env";
import { computeStats, evaluateRoll, makeResolver, parseRollCommand } from "../domain/dice";
import {
  Character,
  ChatMessage,
  ClientFrame,
  Note,
  NoteSummary,
  RollResult,
  SheetTemplate,
  type CursorPosition,
  type MemberRole,
  type PresenceMember,
  SaveCharacterInput,
  type SaveNoteInput,
  SaveTemplateInput,
  type ServerFrame,
  type Visibility,
} from "../domain/schemas";
import {
  BoardSnapshot,
  PublishBoardInput,
  emptyBoard,
  normalizeBoard,
  stripHiddenLayers,
  CreateSceneInput,
  UpdateSceneInput,
  MAX_BOARD_SCENES,
  type SceneMetadata,
} from "../domain/board";
import { newId, nowIso } from "./crypto";
import { oracleRows, oracleRow } from "../domain/oracle";
import { trackerDefinitions } from "../domain/trackers-definitions";

/** The shared permission rule for HTTP and WebSocket character operations. */
export const canEditCharacter = (
  character: Pick<Character, "memberId" | "scope" | "locked"> | undefined,
  memberId: string,
  role: string,
  action: "edit" | "delete" = "edit",
): boolean => {
  if (role === "dm") return true;
  if (!character || !memberId) return false;
  if (action === "delete") return character.scope === "world" && character.memberId === memberId;
  return character.scope === "world" ? !character.locked : character.memberId === memberId;
};

export type WorldDoEnv = CorpusBindings & {
  BUCKET: R2Bucket;
};

type SocketAttachment = {
  memberId: string;
  name: string;
  role: MemberRole;
  cursorId?: string;
  cursorsEnabled?: boolean;
  lastCursorAt?: number;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  fields: string;
  stats: string;
  tickers: string;
  rolls: string;
  layout: string | null;
  updated_at: string;
};

type CharacterRow = {
  id: string;
  member_id: string;
  name: string;
  template_id: string;
  data: string;
  tickers: string;
  ticker_max: string | null;
  layout_prefs: string | null;
  avatar_key: string | null;
  scope: NonNullable<Character["scope"]>;
  locked: number;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  author_member_id: string;
  author_name: string;
  kind: string;
  content: string;
  visibility: string;
  recipient_ids: string;
  roll: string | null;
  author_avatar_key: string | null;
  character_id: string | null;
  created_at: string;
};

type NoteRow = {
  editable_by_all: number;
  id: string;
  title: string;
  owner_member_id: string;
  visibility: string;
  r2_key: string;
  updated_at: string;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const LayoutPrefs = Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(40))).check(
  Schema.isMaxProperties(200),
  Schema.makeFilter((prefs) => Object.keys(prefs).every((key) => key.length <= 80), {
    expected: "Block ids of 80 characters or fewer",
  }),
);

const characterValuesError = (values: Character["values"]): string | undefined => {
  const cellError = (value: string | number | boolean | readonly string[]) => {
    if (typeof value === "string" && value.length > 4000)
      return "Character strings must be 4000 characters or fewer";
    if (typeof value === "number" && !Number.isFinite(value))
      return "Character numbers must be finite";
    if (typeof value === "object") {
      if (value.length > 50) return "String arrays must contain at most 50 items";
      if (value.some((item) => item.length > 4000))
        return "Character strings must be 4000 characters or fewer";
    }
    return undefined;
  };
  for (const [key, value] of Object.entries(values)) {
    if (key.length > 80) return "Character value keys must be 80 characters or fewer";
    if (typeof value !== "object" || value.every((item) => typeof item === "string")) {
      const error = cellError(value);
      if (error) return error;
    } else {
      if (value.length > 100) return "Lists must contain at most 100 rows";
      for (const row of value) {
        if (typeof row === "string") continue;
        for (const [column, cell] of Object.entries(row)) {
          if (column.length > 80) return "List column keys must be 80 characters or fewer";
          const error = cellError(cell);
          if (error) return error;
        }
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(values)).byteLength > 64 * 1024)
    return "Serialized character values must be 64 KB or smaller";
  return undefined;
};

export const defaultTemplate = (worldId: string): SheetTemplate => ({
  id: "tpl_default",
  worldId,
  name: "Adventurer",
  description: "A flexible starter sheet. Duplicate and edit it for your system.",
  fields: [
    { id: "race", label: "Race", kind: "text", group: "Identity" },
    { id: "class", label: "Class", kind: "text", group: "Identity" },
    { id: "level", label: "Level", kind: "number", defaultValue: 1, group: "Identity" },
    { id: "str", label: "Strength", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "dex", label: "Dexterity", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "con", label: "Constitution", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "int", label: "Intelligence", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "wis", label: "Wisdom", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "cha", label: "Charisma", kind: "number", defaultValue: 10, group: "Attributes" },
    { id: "background", label: "Background", kind: "longtext", group: "Story" },
  ],
  stats: [
    { id: "strMod", label: "STR modifier", modifiers: [{ kind: "field", fieldId: "str" }] },
    { id: "dexMod", label: "DEX modifier", modifiers: [{ kind: "field", fieldId: "dex" }] },
    { id: "prof", label: "Proficiency", base: 2, modifiers: [] },
  ],
  tickers: [
    { id: "hp", label: "HP", min: 0, max: 40, defaultValue: 20, color: "#d23401" },
    { id: "mp", label: "Mana", min: 0, max: 30, defaultValue: 10, color: "#2f80fa" },
  ],
  rolls: [
    {
      id: "str_check",
      label: "Strength check",
      dice: [{ count: 1, sides: 20 }],
      modifiers: [{ kind: "stat", statId: "strMod" }],
      visibility: "public",
    },
    {
      id: "attack",
      label: "Attack",
      dice: [{ count: 1, sides: 8 }],
      modifiers: [
        { kind: "stat", statId: "strMod" },
        { kind: "static", value: 2 },
      ],
      visibility: "public",
    },
    {
      id: "sneak",
      label: "Sneak",
      dice: [
        { count: 1, sides: 20 },
        { count: 1, sides: 6 },
      ],
      modifiers: [{ kind: "stat", statId: "dexMod" }],
      visibility: "private",
    },
  ],
  updatedAt: nowIso(),
});

export class WorldDO extends DurableObject<WorldDoEnv> {
  private readonly compendium: WorldCompendium;
  private readonly sources: WorldSources;
  constructor(ctx: DurableObjectState, env: WorldDoEnv) {
    super(ctx, env);
    this.compendium = new WorldCompendium({
      sql: ctx.storage.sql,
      broadcast: (frame) => this.broadcast(frame),
      transactionSync: (closure) => ctx.storage.transactionSync(closure),
      bucket: env.BUCKET,
      worldId: this.worldId,
    });
    this.sources = new WorldSources({
      sql: ctx.storage.sql,
      transactionSync: (closure) => ctx.storage.transactionSync(closure),
      compendium: this.compendium,
      corpus: corpusEnabled(env) ? env.CORPUS : undefined,
      bucket: corpusEnabled(env) ? env.CORPUS_BUCKET : undefined,
      accountId: () =>
        ctx.storage.sql
          .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'corpus_account_id'")
          .toArray()[0]?.value ?? "",
    });
    this.compendium.setSources(this.sources);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
      await this.compendium.ensureMigrated();
    });
  }

  private activeSceneId(): string {
    return this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'active_scene_id'")
      .one().value;
  }

  private getBoard(sceneId = this.activeSceneId()): BoardSnapshot {
    const row = this.ctx.storage.sql
      .exec<{ snapshot: string; name: string }>(
        "SELECT snapshot, name FROM scenes WHERE id = ?",
        sceneId,
      )
      .one();
    const snapshot = Schema.decodeUnknownSync(BoardSnapshot)(JSON.parse(row.snapshot));
    return {
      ...snapshot,
      sceneId,
      sceneName: row.name,
      document: normalizeBoard(snapshot.document),
    };
  }

  private listScenes(): SceneMetadata[] {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        name: string;
        sort: number;
        group_name: string | null;
        snapshot: string;
        updated_at: string;
      }>("SELECT * FROM scenes ORDER BY sort, id")
      .toArray()
      .map((row) => {
        const snapshot = Schema.decodeUnknownSync(BoardSnapshot)(JSON.parse(row.snapshot));
        return {
          id: row.id,
          name: row.name,
          sort: row.sort,
          group: row.group_name,
          updatedAt: row.updated_at,
          revision: snapshot.revision,
          elementCount: snapshot.document.elements.length,
        };
      });
  }

  private boardFrame(sceneId: string, role: string): Extract<ServerFrame, { type: "board" }> {
    const board = this.getBoard(sceneId);
    return {
      type: "board",
      sceneId,
      sceneName: board.sceneName ?? "Scene",
      activeSceneId: this.activeSceneId(),
      board: role === "dm" ? board : stripHiddenLayers(board),
    };
  }

  private broadcastBoard(sceneId: string) {
    this.broadcast(this.boardFrame(sceneId, "dm"), (session) => session.role === "dm");
    if (sceneId === this.activeSceneId())
      this.broadcast(this.boardFrame(sceneId, "player"), (session) => session.role !== "dm");
    this.broadcastScenes();
  }

  private broadcastScenes() {
    this.broadcast(
      { type: "scenes", scenes: this.listScenes(), activeSceneId: this.activeSceneId() },
      (session) => session.role === "dm",
    );
  }

  private publishScene(sceneId: string, body: unknown): Response {
    const decoded = Schema.decodeUnknownResult(PublishBoardInput)(body);
    if (decoded._tag === "Failure") return json({ error: "Invalid board" }, 400);
    if (decoded.success.sceneId !== undefined && decoded.success.sceneId !== sceneId)
      return json({ error: "The active scene changed. Load it before publishing again." }, 400);
    const current = this.getBoard(sceneId);
    if (decoded.success.revision !== current.revision)
      return json(
        { error: "The shared board changed. Load the published board before publishing again." },
        400,
      );
    const board: BoardSnapshot = {
      sceneId,
      sceneName: current.sceneName,
      revision: current.revision + 1,
      document: normalizeBoard(decoded.success.document),
    };
    this.ctx.storage.sql.exec(
      "UPDATE scenes SET snapshot = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(board),
      nowIso(),
      sceneId,
    );
    this.broadcastBoard(sceneId);
    return json(board);
  }

  private handleScenes(method: string, path: string, body: unknown): Response {
    const [, sceneId, action] = path.split("/");
    const scenes = this.listScenes();
    const sql = this.ctx.storage.sql;
    if (!sceneId) {
      if (method === "GET") return json({ scenes, activeSceneId: this.activeSceneId() });
      if (method !== "POST") return json({ error: "Not found" }, 404);
      const input = Schema.decodeUnknownResult(CreateSceneInput)(body);
      if (input._tag === "Failure") return json({ error: "Invalid scene" }, 400);
      if (scenes.length >= MAX_BOARD_SCENES)
        return json({ error: "A world can have at most 50 scenes" }, 400);
      if (
        input.success.duplicateFrom &&
        !scenes.some((scene) => scene.id === input.success.duplicateFrom)
      )
        return json({ error: "Scene not found" }, 404);
      const document = input.success.duplicateFrom
        ? this.getBoard(input.success.duplicateFrom).document
        : emptyBoard().document;
      const id = crypto.randomUUID();
      sql.exec(
        "INSERT INTO scenes (id, name, sort, group_name, snapshot, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
        id,
        input.success.name,
        scenes.length,
        JSON.stringify({ revision: 0, document }),
        nowIso(),
      );
      this.broadcastScenes();
      return json(this.getBoard(id), 201);
    }
    if (!scenes.some((scene) => scene.id === sceneId))
      return json({ error: "Scene not found" }, 404);
    if (action === "active" && method === "POST") {
      sql.exec("UPDATE settings SET value = ? WHERE key = 'active_scene_id'", sceneId);
      this.broadcastBoard(sceneId);
      return json(this.getBoard(sceneId));
    }
    if (action) return json({ error: "Not found" }, 404);
    if (method === "GET") return json(this.getBoard(sceneId));
    if (method === "PUT") return this.publishScene(sceneId, body);
    if (method === "PATCH") {
      const input = Schema.decodeUnknownResult(UpdateSceneInput)(body);
      if (input._tag === "Failure") return json({ error: "Invalid scene" }, 400);
      const update = input.success;
      if (update.name !== undefined)
        sql.exec("UPDATE scenes SET name = ? WHERE id = ?", update.name, sceneId);
      if (update.group !== undefined)
        sql.exec("UPDATE scenes SET group_name = ? WHERE id = ?", update.group, sceneId);
      if (update.sort !== undefined) {
        const order = scenes.map((scene) => scene.id).filter((id) => id !== sceneId);
        order.splice(Math.min(update.sort, order.length), 0, sceneId);
        order.forEach((id, index) =>
          sql.exec("UPDATE scenes SET sort = ? WHERE id = ?", index, id),
        );
      }
      sql.exec("UPDATE scenes SET updated_at = ? WHERE id = ?", nowIso(), sceneId);
      this.broadcastBoard(sceneId);
      return json(this.getBoard(sceneId));
    }
    if (method === "DELETE") {
      if (scenes.length === 1) return json({ error: "Cannot delete the last scene" }, 400);
      const active = this.activeSceneId() === sceneId;
      const remaining = scenes.filter((scene) => scene.id !== sceneId);
      sql.exec("DELETE FROM scenes WHERE id = ?", sceneId);
      remaining.forEach((scene, index) =>
        sql.exec("UPDATE scenes SET sort = ? WHERE id = ?", index, scene.id),
      );
      if (active) {
        const neighbor =
          remaining[
            Math.min(
              scenes.findIndex((scene) => scene.id === sceneId),
              remaining.length - 1,
            )
          ];
        sql.exec("UPDATE settings SET value = ? WHERE key = 'active_scene_id'", neighbor.id);
        this.broadcastBoard(neighbor.id);
      } else this.broadcastScenes();
      return json({ scenes: this.listScenes(), activeSceneId: this.activeSceneId() });
    }
    return json({ error: "Not found" }, 404);
  }

  private get worldId() {
    return this.ctx.id.name?.replace(/^world:/, "") ?? "unknown";
  }

  private ensureSchema() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL, group_name TEXT, snapshot TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    if (!sql.exec("SELECT id FROM scenes LIMIT 1").toArray().length) {
      const legacy = sql
        .exec<{ snapshot: string }>("SELECT snapshot FROM board WHERE id = 1")
        .toArray()[0];
      const id = crypto.randomUUID();
      sql.exec(
        "INSERT INTO scenes (id, name, sort, snapshot, updated_at) VALUES (?, 'Scene 1', 0, ?, ?)",
        id,
        legacy?.snapshot ?? JSON.stringify(emptyBoard()),
        nowIso(),
      );
      sql.exec(
        "INSERT INTO settings (key, value) VALUES ('active_scene_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        id,
      );
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      fields TEXT NOT NULL,
      stats TEXT NOT NULL,
      tickers TEXT NOT NULL,
      rolls TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL,
      data TEXT NOT NULL,
      tickers TEXT NOT NULL,
      avatar_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      author_member_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      visibility TEXT NOT NULL,
      recipient_ids TEXT NOT NULL,
      roll TEXT,
      author_avatar_key TEXT,
      character_id TEXT,
      created_at TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_member_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.compendium.migrate();
    this.sources.migrate();
    // Additive columns for instances created before the feature existed.
    this.ensureColumn("templates", "layout", "layout TEXT");
    this.ensureColumn("notes", "editable_by_all", "editable_by_all INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("characters", "avatar_key", "avatar_key TEXT");
    this.ensureColumn("characters", "ticker_max", "ticker_max TEXT");
    this.ensureColumn("characters", "layout_prefs", "layout_prefs TEXT");
    this.ensureColumn("characters", "scope", "scope TEXT NOT NULL DEFAULT 'member'");
    this.ensureColumn("characters", "locked", "locked INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("messages", "author_avatar_key", "author_avatar_key TEXT");
    this.ensureColumn("messages", "character_id", "character_id TEXT");
    const existing = sql.exec("SELECT COUNT(*) AS n FROM templates").one() as { n: number };
    if (!existing || existing.n === 0) this.insertTemplate(defaultTemplate(this.worldId));
  }

  private ensureColumn(table: string, column: string, ddl: string) {
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>(`PRAGMA table_info(${table})`)
      .toArray();
    if (!columns.some((existing) => existing.name === column)) {
      this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  // -------------------------------------------------------------------------
  // Row mapping
  // -------------------------------------------------------------------------

  private toTemplate(row: TemplateRow): SheetTemplate {
    const layout = Schema.decodeUnknownResult(SheetLayout)(parse<unknown>(row.layout, undefined));
    return {
      id: row.id,
      worldId: this.worldId,
      name: row.name,
      description: row.description ?? undefined,
      fields: parse(row.fields, []),
      stats: parse(row.stats, []),
      tickers: parse(row.tickers, []),
      rolls: parse(row.rolls, []),
      layout: layout._tag === "Success" ? layout.success : undefined,
      updatedAt: row.updated_at,
    };
  }

  private toCharacter(row: CharacterRow): Character {
    const values = Schema.decodeUnknownResult(Character.fields.values)(
      parse<unknown>(row.data, {}),
    );
    const prefs = Schema.decodeUnknownResult(LayoutPrefs)(
      parse<unknown>(row.layout_prefs, undefined),
    );
    return {
      id: row.id,
      worldId: this.worldId,
      memberId: row.member_id,
      name: row.name,
      templateId: row.template_id,
      values: values._tag === "Success" ? values.success : {},
      tickers: parse(row.tickers, {}),
      tickerMax: parse(row.ticker_max, {}),
      layoutPrefs: prefs._tag === "Success" ? prefs.success : undefined,
      avatarKey: row.avatar_key ?? undefined,
      scope: row.scope ?? "member",
      locked: Boolean(row.locked),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      worldId: this.worldId,
      authorMemberId: row.author_member_id,
      authorName: row.author_name,
      kind: row.kind as ChatMessage["kind"],
      content: row.content,
      visibility: row.visibility as Visibility,
      recipientMemberIds: parse(row.recipient_ids, []),
      roll: row.roll ? parse<RollResult>(row.roll, undefined as never) : undefined,
      authorAvatarKey: row.author_avatar_key ?? undefined,
      characterId: row.character_id ?? undefined,
      createdAt: row.created_at,
    };
  }

  private toNoteSummary(row: NoteRow): NoteSummary {
    return {
      id: row.id,
      title: row.title,
      ownerMemberId: row.owner_member_id,
      editableByAll: row.editable_by_all === 1,
      visibility: row.visibility as Visibility,
      updatedAt: row.updated_at,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  private listTemplates(): SheetTemplate[] {
    const rows = this.ctx.storage.sql
      .exec<TemplateRow>("SELECT * FROM templates ORDER BY updated_at DESC")
      .toArray();
    return rows.map((row) => this.toTemplate(row));
  }

  private getTemplate(id?: string): SheetTemplate | undefined {
    const rows = id
      ? this.ctx.storage.sql
          .exec<TemplateRow>("SELECT * FROM templates WHERE id = ? LIMIT 1", id)
          .toArray()
      : this.ctx.storage.sql
          .exec<TemplateRow>("SELECT * FROM templates ORDER BY updated_at DESC LIMIT 1")
          .toArray();
    return rows[0] ? this.toTemplate(rows[0]) : undefined;
  }

  private listCharacters(): Character[] {
    const rows = this.ctx.storage.sql
      .exec<CharacterRow>("SELECT * FROM characters ORDER BY created_at ASC")
      .toArray();
    return rows.map((row) => this.toCharacter(row));
  }

  private getCharacter(id: string): Character | undefined {
    const rows = this.ctx.storage.sql
      .exec<CharacterRow>("SELECT * FROM characters WHERE id = ? LIMIT 1", id)
      .toArray();
    return rows[0] ? this.toCharacter(rows[0]) : undefined;
  }

  private listMessages(options?: { limit?: number; beforeCreatedAt?: string; beforeId?: string }): {
    messages: ChatMessage[];
    hasMore: boolean;
  } {
    const limit = options?.limit ?? 50;
    const beforeCreatedAt = options?.beforeCreatedAt;
    const beforeId = options?.beforeId;
    const rows = this.ctx.storage.sql
      .exec<MessageRow>(
        `SELECT * FROM messages
         WHERE ? IS NULL
            OR created_at < ?
            OR (created_at = ? AND id < ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        beforeCreatedAt ?? null,
        beforeCreatedAt ?? null,
        beforeCreatedAt ?? null,
        beforeId ?? null,
        limit + 1,
      )
      .toArray();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { messages: page.map((row) => this.toMessage(row)).reverse(), hasMore };
  }

  private listNotes(): NoteSummary[] {
    const rows = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes ORDER BY updated_at DESC")
      .toArray();
    return rows.map((row) => this.toNoteSummary(row));
  }

  private async getNote(id: string): Promise<Note | undefined> {
    const rows = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
      .toArray();
    const row = rows[0];
    if (!row) return undefined;
    const object = await this.env.BUCKET.get(row.r2_key);
    const content = object ? await object.text() : "";
    return { ...this.toNoteSummary(row), content };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private insertTemplate(template: SheetTemplate) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO templates (id, name, description, fields, stats, tickers, rolls, layout, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      template.id,
      template.name,
      template.description ?? null,
      JSON.stringify(template.fields),
      JSON.stringify(template.stats),
      JSON.stringify(template.tickers),
      JSON.stringify(template.rolls),
      template.layout ? JSON.stringify(template.layout) : null,
      template.updatedAt,
    );
  }

  private saveTemplate(input: SaveTemplateInput & { id?: string }): SheetTemplate {
    const id = input.id ?? newId("tpl");
    const existing = this.getTemplate(id);
    const template: SheetTemplate = {
      id,
      worldId: this.worldId,
      name: input.name,
      description: input.description,
      fields: input.fields,
      stats: input.stats,
      tickers: input.tickers,
      rolls: input.rolls,
      layout: input.layout,
      updatedAt: nowIso(),
    };
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE templates SET name = ?, description = ?, fields = ?, stats = ?, tickers = ?, rolls = ?, layout = ?, updated_at = ? WHERE id = ?",
        template.name,
        template.description ?? null,
        JSON.stringify(template.fields),
        JSON.stringify(template.stats),
        JSON.stringify(template.tickers),
        JSON.stringify(template.rolls),
        template.layout ? JSON.stringify(template.layout) : null,
        template.updatedAt,
        id,
      );
    } else {
      this.insertTemplate(template);
    }
    return template;
  }

  private canSaveCharacter(input: SaveCharacterInput, memberId: string, role: string): boolean {
    const existing = input.id === undefined ? undefined : this.getCharacter(input.id);
    if (existing) {
      return (
        canEditCharacter(existing, memberId, role) &&
        (role === "dm" ||
          existing.scope === "world" ||
          input.memberId === undefined ||
          input.memberId === memberId)
      );
    }
    return (
      role === "dm" ||
      (Boolean(memberId) && (input.memberId === undefined || input.memberId === memberId))
    );
  }

  private canEditCharacter(id: string, memberId: string, role: string): boolean {
    return canEditCharacter(this.getCharacter(id), memberId, role);
  }

  private saveCharacter(input: SaveCharacterInput): Character {
    const now = nowIso();
    const id = input.id ?? newId("chr");
    const existing = this.getCharacter(id);
    const template = this.getTemplate(input.templateId) ?? this.getTemplate();
    const tickers: Record<string, number> = existing ? { ...existing.tickers } : {};
    const tickerMax = { ...(input.tickerMax ?? existing?.tickerMax) };
    for (const ticker of trackerDefinitions(template)) {
      if (tickerMax[ticker.id] !== undefined)
        tickerMax[ticker.id] = Math.max(ticker.min, tickerMax[ticker.id]);
      tickers[ticker.id] = Math.max(
        ticker.min,
        Math.min(tickerMax[ticker.id] ?? ticker.max, tickers[ticker.id] ?? ticker.defaultValue),
      );
    }
    const character: Character = {
      id,
      worldId: this.worldId,
      memberId:
        existing?.scope === "world"
          ? existing.memberId
          : (input.memberId ?? existing?.memberId ?? ""),
      scope: existing?.scope ?? input.scope ?? "member",
      locked: existing?.locked ?? false,
      name: input.name,
      templateId: input.templateId,
      values: input.values,
      tickers,
      tickerMax,
      layoutPrefs: existing?.layoutPrefs,
      avatarKey: existing?.avatarKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE characters SET member_id = ?, name = ?, template_id = ?, data = ?, tickers = ?, ticker_max = ?, updated_at = ? WHERE id = ?",
        character.memberId,
        character.name,
        character.templateId,
        JSON.stringify(character.values),
        JSON.stringify(character.tickers),
        JSON.stringify(character.tickerMax),
        now,
        id,
      );
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO characters (id, member_id, name, template_id, data, tickers, ticker_max, scope, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        character.memberId,
        character.name,
        character.templateId,
        JSON.stringify(character.values),
        JSON.stringify(character.tickers),
        JSON.stringify(character.tickerMax),
        character.scope ?? "member",
        character.locked ? 1 : 0,
        now,
        now,
      );
    }
    return character;
  }

  private deleteCharacter(id: string) {
    this.ctx.storage.sql.exec("DELETE FROM characters WHERE id = ?", id);
  }

  private setTicker(characterId: string, tickerId: string, value: number): Character | undefined {
    const character = this.getCharacter(characterId);
    if (!character) return undefined;
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    const definition = trackerDefinitions(template).find((ticker) => ticker.id === tickerId);
    if (!definition) return undefined;
    const clamped = Math.max(
      definition.min,
      Math.min(character.tickerMax?.[tickerId] ?? definition.max, value),
    );
    const updated: Character = {
      ...character,
      tickers: { ...character.tickers, [tickerId]: clamped },
      updatedAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      "UPDATE characters SET tickers = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(updated.tickers),
      updated.updatedAt,
      characterId,
    );
    return updated;
  }

  private setCharacterValue(
    characterId: string,
    key: string,
    value: Character["values"][string],
  ): { character: Character } | { error: string } {
    const character = this.getCharacter(characterId);
    if (!character) return { error: "Character not found" };
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    if (trackerDefinitions(template).some((tracker) => tracker.id === key))
      return { error: "Tracker values must be updated with ticker.set" };
    const values = { ...character.values, [key]: value };
    const error = characterValuesError(values);
    if (error) return { error };
    const updated: Character = { ...character, values, updatedAt: nowIso() };
    // No await between reading and writing: frames cannot overwrite each other's keys.
    this.ctx.storage.sql.exec(
      "UPDATE characters SET data = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(values),
      updated.updatedAt,
      characterId,
    );
    return { character: updated };
  }

  private setLayoutPref(
    characterId: string,
    blockId: string,
    variant: string | null,
  ): { character: Character } | { error: string } {
    const character = this.getCharacter(characterId);
    if (!character) return { error: "Character not found" };
    if (blockId.length > 80) return { error: "Block ids must be 80 characters or fewer" };
    if (variant !== null && variant.length > 40)
      return { error: "Layout variants must be 40 characters or fewer" };
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    if (
      template?.layout &&
      !template.layout.pages.some((page) =>
        page.blocks.some(
          (block) =>
            block.id === blockId ||
            (block.type === "group" && block.blocks.some((child) => child.id === blockId)),
        ),
      )
    )
      return { error: "Layout block not found" };
    const layoutPrefs =
      variant === null
        ? { ...character.layoutPrefs }
        : { ...character.layoutPrefs, [blockId]: variant };
    if (variant === null) delete layoutPrefs[blockId];
    if (Object.keys(layoutPrefs).length > 200)
      return { error: "Layout preferences must contain at most 200 entries" };
    const updated: Character = { ...character, layoutPrefs, updatedAt: nowIso() };
    this.ctx.storage.sql.exec(
      "UPDATE characters SET layout_prefs = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(layoutPrefs),
      updated.updatedAt,
      characterId,
    );
    return { character: updated };
  }

  private setCharacterAvatar(
    characterId: string,
    avatarKey: string | undefined,
  ): Character | undefined {
    const character = this.getCharacter(characterId);
    if (!character) return undefined;
    const updated: Character = { ...character, avatarKey, updatedAt: nowIso() };
    this.ctx.storage.sql.exec(
      "UPDATE characters SET avatar_key = ?, updated_at = ? WHERE id = ?",
      avatarKey ?? null,
      updated.updatedAt,
      characterId,
    );
    return updated;
  }

  private characterForMember(memberId: string): Character | undefined {
    const rows = this.ctx.storage.sql
      .exec<CharacterRow>(
        "SELECT * FROM characters WHERE member_id = ? ORDER BY created_at ASC LIMIT 1",
        memberId,
      )
      .toArray();
    return rows[0] ? this.toCharacter(rows[0]) : undefined;
  }

  private createMessage(input: {
    authorMemberId: string;
    authorName: string;
    kind: ChatMessage["kind"];
    content: string;
    visibility: Visibility;
    recipientMemberIds: readonly string[];
    roll?: RollResult;
    authorAvatarKey?: string;
    characterId?: string;
  }): ChatMessage {
    const message: ChatMessage = {
      id: newId("msg"),
      worldId: this.worldId,
      authorMemberId: input.authorMemberId,
      authorName: input.authorName,
      kind: input.kind,
      content: input.content,
      visibility: input.visibility,
      recipientMemberIds: input.recipientMemberIds,
      roll: input.roll,
      authorAvatarKey: input.authorAvatarKey,
      characterId: input.characterId,
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, author_member_id, author_name, kind, content, visibility, recipient_ids, roll, author_avatar_key, character_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      message.id,
      message.authorMemberId,
      message.authorName,
      message.kind,
      message.content,
      message.visibility,
      JSON.stringify(message.recipientMemberIds),
      message.roll ? JSON.stringify(message.roll) : null,
      message.authorAvatarKey ?? null,
      message.characterId ?? null,
      message.createdAt,
    );
    return message;
  }

  private directRoll(
    frame: Extract<ClientFrame, { type: "roll.dice" }>,
    attachment: SocketAttachment,
  ): Parsed<ChatMessage> {
    // parseRollCommand lowercases refs; strip the prefix from the original instead.
    const cleaned =
      parseRollCommand(frame.notation) === null
        ? frame.notation
        : frame.notation.trim().replace(/^\/roll\s*/i, "");
    const parsed = parseNotation(cleaned);
    if (!parsed.ok) return parsed;

    let character: Character | undefined;
    if (notationRefs(parsed.value).length || frame.characterId !== undefined) {
      // `/roll 1d20 + @str_mod` in chat reads the sender's own character.
      const characterId = frame.characterId ?? this.characterForMember(attachment.memberId)?.id;
      if (characterId === undefined)
        return { ok: false, error: "Choose a character to roll sheet values" };
      character = this.getCharacter(characterId);
      if (!character) return { ok: false, error: "Character not found" };
      if (!this.canEditCharacter(character.id, attachment.memberId, attachment.role))
        return { ok: false, error: "You cannot roll for this character" };
    }

    let row: ListRow | undefined;
    if (frame.row !== undefined) {
      const rows = character?.values[frame.row.key];
      const selected = Array.isArray(rows) ? rows[frame.row.index] : undefined;
      if (typeof selected !== "object" || selected === null || Array.isArray(selected))
        return { ok: false, error: "List row not found" };
      row = selected;
    }
    const layout = character ? this.getTemplate(character.templateId)?.layout : undefined;
    const rolled = rollText(cleaned, {
      lookup: character
        ? sheetRefLookup(layout, refValues(layout, character.values, character.tickers), row)
        : undefined,
    });
    if (!rolled.ok) return rolled;

    const authorCharacter = character ?? this.characterForMember(attachment.memberId);
    return {
      ok: true,
      value: this.createMessage({
        authorMemberId: attachment.memberId,
        authorName: attachment.name,
        kind: "roll",
        content: (frame.label ?? "").trim(),
        visibility: frame.visibility,
        recipientMemberIds: frame.recipientMemberIds ?? [],
        roll: rolled.value,
        authorAvatarKey: authorCharacter?.avatarKey,
        characterId: authorCharacter?.id,
      }),
    };
  }

  private async tableRoll(
    frame: Extract<ClientFrame, { type: "roll.table" }>,
    attachment: SocketAttachment,
  ): Promise<Parsed<ChatMessage>> {
    const found = await this.compendium.lookup(frame.entryId, attachment.role);
    if (!found) return { ok: false, error: "Entry not found" };
    const { entry, type } = found;
    const field = type.fields.find((field) => field.key === frame.field);
    if (field?.kind !== "oracle" || !field.dice)
      return { ok: false, error: "Oracle field not found" };
    const parsed = parseNotation(field.dice);
    if (!parsed.ok) return parsed;
    if (notationRefs(parsed.value).length)
      return { ok: false, error: "Oracle dice cannot use sheet references" };
    const rows = oracleRows(entry.fields[field.key]);
    if (!rows.ok) return rows;
    const rolled = rollText(field.dice);
    if (!rolled.ok) return rolled;
    return {
      ok: true,
      value: this.createMessage({
        authorMemberId: attachment.memberId,
        authorName: attachment.name,
        kind: "roll",
        content: `${entry.name} · ${field.label}`,
        visibility: frame.visibility,
        recipientMemberIds: frame.recipientMemberIds ?? [],
        roll: {
          ...rolled.value,
          table: {
            entryId: entry.id,
            entryName: entry.name,
            field: field.key,
            fieldLabel: field.label,
            row: oracleRow(rows.value, rolled.value.total),
          },
        },
      }),
    };
  }

  private rollFor(characterId: string, rollId: string) {
    const character = this.getCharacter(characterId);
    if (!character) return undefined;
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    if (!template) return undefined;
    const definition = template.rolls.find((roll) => roll.id === rollId);
    if (!definition) return undefined;
    const stats = computeStats(template.stats, character.values);
    const resolver = makeResolver(character.values, stats);
    return { character, definition, result: evaluateRoll(definition, resolver) };
  }

  private noteWrites: Promise<void> = Promise.resolve();

  private writeNote<T>(write: () => Promise<T>): Promise<T> {
    // R2 awaits allow other requests to run; keep permission checks and writes ordered.
    const result = this.noteWrites.then(write);
    this.noteWrites = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private saveNote(
    input: SaveNoteInput & { id?: string; ownerMemberId: string },
    role: MemberRole,
  ) {
    return this.writeNote(() => this.persistNote(input, role));
  }

  private async persistNote(
    input: SaveNoteInput & { id?: string; ownerMemberId: string },
    role: MemberRole,
  ): Promise<{ note: Note } | { forbidden: true }> {
    const id = input.id ?? newId("note");
    const existing = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
      .toArray()[0];
    if (
      existing &&
      !canSaveNote(this.toNoteSummary(existing), input, { id: input.ownerMemberId, role })
    ) {
      return { forbidden: true };
    }
    const editableByAll = input.editableByAll ?? existing?.editable_by_all === 1;
    const prefix = `world/${this.worldId}`;
    const key = existing?.r2_key ?? `${prefix}/notes/${id}.md`;
    await this.env.BUCKET.put(key, input.content, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    const updatedAt = nowIso();
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE notes SET title = ?, visibility = ?, editable_by_all = ?, updated_at = ? WHERE id = ?",
        input.title,
        input.visibility,
        editableByAll ? 1 : 0,
        updatedAt,
        id,
      );
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO notes (id, title, owner_member_id, visibility, r2_key, updated_at, editable_by_all) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        input.title,
        input.ownerMemberId,
        input.visibility,
        key,
        updatedAt,
        editableByAll ? 1 : 0,
      );
    }
    this.broadcastNotes(existing ? this.toNoteSummary(existing) : undefined, {
      id,
      title: input.title,
      ownerMemberId: existing?.owner_member_id ?? input.ownerMemberId,
      visibility: input.visibility,
      editableByAll,
      updatedAt,
    });
    return {
      note: {
        id,
        title: input.title,
        ownerMemberId: existing?.owner_member_id ?? input.ownerMemberId,
        visibility: input.visibility,
        editableByAll,
        content: input.content,
        updatedAt,
      },
    };
  }

  private deleteNote(id: string, ownerMemberId: string) {
    return this.writeNote(() => this.removeNote(id, ownerMemberId));
  }

  private async removeNote(
    id: string,
    ownerMemberId: string,
  ): Promise<{ ok: true } | { forbidden: true }> {
    const row = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
      .toArray()[0];
    if (row && row.owner_member_id !== ownerMemberId) return { forbidden: true };
    if (row) await this.env.BUCKET.delete(row.r2_key);
    this.ctx.storage.sql.exec("DELETE FROM notes WHERE id = ?", id);
    if (row) this.broadcastNotes(this.toNoteSummary(row));
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  private sessions(): SocketAttachment[] {
    return this.ctx
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment() as SocketAttachment | null)
      .filter((value): value is SocketAttachment => value !== null);
  }

  private presence(): PresenceMember[] {
    const seen = new Map<string, PresenceMember>();
    for (const session of this.sessions()) {
      seen.set(session.memberId, {
        id: session.memberId,
        displayName: session.name,
        role: session.role,
        online: true,
      });
    }
    return [...seen.values()];
  }

  private visibleTo(message: ChatMessage, viewer: SocketAttachment) {
    if (message.authorMemberId === viewer.memberId) return true;
    if (message.recipientMemberIds.length > 0) {
      return message.recipientMemberIds.includes(viewer.memberId) || viewer.role === "dm";
    }
    switch (message.visibility) {
      case "public":
        return true;
      case "dm":
        return viewer.role === "dm";
      case "private":
        return false;
    }
  }

  private broadcast(
    frame: ServerFrame,
    filter?: (session: SocketAttachment, socket: WebSocket) => boolean,
  ) {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      if (filter && !filter(attachment, socket)) continue;
      try {
        socket.send(payload);
      } catch {
        // socket is closing; ignore
      }
    }
  }

  private broadcastNotes(previous?: NoteSummary, current?: NoteSummary) {
    this.broadcast({ type: "notes.updated" }, (session) => {
      const viewer = { id: session.memberId, role: session.role };
      return !!(
        (previous && canSeeNote(previous, viewer)) ||
        (current && canSeeNote(current, viewer))
      );
    });
  }

  private broadcastMessage(message: ChatMessage) {
    this.broadcast({ type: "message", message }, (session) => this.visibleTo(message, session));
  }

  private broadcastCursor(attachment: SocketAttachment, position: CursorPosition | null) {
    if (!attachment.cursorId) return;
    this.broadcast(
      {
        type: "cursor",
        cursor: {
          id: attachment.cursorId,
          memberId: attachment.memberId,
          displayName: attachment.name,
          position,
        },
      },
      (session) => !!session.cursorsEnabled && session.memberId !== attachment.memberId,
    );
  }

  // -------------------------------------------------------------------------
  // Fetch: websockets + internal JSON API
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corpusAccountId = request.headers.get("x-ttrpg-corpus-account-id");
    if (corpusAccountId)
      this.ctx.storage.sql.exec(
        "INSERT INTO settings (key,value) VALUES ('corpus_account_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        corpusAccountId,
      );

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      if (corpusEnabled(this.env)) {
        await this.sources
          .check()
          .catch((error: unknown) => console.error("Library refresh failed", error));
        await this.scheduleSourceCheck();
      }
      return this.handleUpgrade(request);
    }

    if (url.pathname.startsWith("/internal/")) {
      return this.handleInternal(request, url);
    }

    return json({ error: "Not found" }, 404);
  }

  private async scheduleSourceCheck(): Promise<void> {
    if (
      corpusEnabled(this.env) &&
      this.ctx.storage.sql.exec("SELECT source_id FROM world_sources LIMIT 1").toArray().length
    )
      await this.ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    if (corpusEnabled(this.env))
      await this.sources
        .check()
        .catch((error: unknown) => console.error("Library refresh failed", error));
    await this.scheduleSourceCheck();
  }

  private handleUpgrade(request: Request): Response {
    const memberId = request.headers.get("x-ttrpg-member-id");
    const name = request.headers.get("x-ttrpg-member-name") ?? "Unknown";
    const role = (request.headers.get("x-ttrpg-role") as MemberRole | null) ?? "player";
    if (!memberId) return json({ error: "Missing identity" }, 401);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { memberId, name, role };
    server.serializeAttachment(attachment);

    const worldMember = {
      id: memberId,
      worldId: this.worldId,
      displayName: name,
      role,
      kind: "password" as const,
      createdAt: nowIso(),
    };
    server.send(
      JSON.stringify({
        type: "hello",
        worldId: this.worldId,
        member: worldMember,
        members: this.presence(),
      } satisfies ServerFrame),
    );
    server.send(JSON.stringify(this.boardFrame(this.activeSceneId(), role)));
    if (role === "dm")
      server.send(
        JSON.stringify({
          type: "scenes",
          scenes: this.listScenes(),
          activeSceneId: this.activeSceneId(),
        } satisfies ServerFrame),
      );
    this.broadcast({ type: "presence", members: this.presence() });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleInternal(request: Request, url: URL): Promise<Response> {
    if (url.pathname.startsWith("/internal/compendium")) {
      const check = this.compendium.checkRequest(request, url);
      const response = check instanceof Promise ? await check : check;
      if (response) return response;
    }
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const memberId = request.headers.get("x-ttrpg-member-id") ?? "";
    const role = request.headers.get("x-ttrpg-role") ?? "";
    const memberName = request.headers.get("x-ttrpg-member-name") ?? "Unknown";
    const path = url.pathname.replace(/^\/internal\//, "");

    try {
      if (
        path === "libraries" ||
        path.startsWith("libraries/") ||
        path.startsWith("compendium/overrides/") ||
        path.startsWith("compendium/blocked/")
      ) {
        const response = await this.sources.handle(request.method, path, body, role);
        await this.scheduleSourceCheck();
        return response;
      }
      if (path === "compendium" || path.startsWith("compendium/"))
        return this.compendium.handle(
          request.method,
          path,
          body,
          role,
          decodeURIComponent(request.headers.get("x-ttrpg-world-name") ?? "World"),
          url.searchParams.get("since"),
        );
      if (path === "scenes" || path.startsWith("scenes/")) {
        if (role !== "dm") return json({ error: "Only the DM can manage scenes" }, 403);
        return this.handleScenes(request.method, path, body);
      }
      switch (`${request.method} ${path}`) {
        case "GET board":
          return json(role === "dm" ? this.getBoard() : stripHiddenLayers(this.getBoard()));
        case "PUT board": {
          if (role !== "dm") return json({ error: "Only the DM can publish the board" }, 403);
          return this.publishScene(this.activeSceneId(), body);
        }
        case "GET state": {
          const page = this.listMessages({ limit: 50 });
          return json({
            board: role === "dm" ? this.getBoard() : stripHiddenLayers(this.getBoard()),
            ...(role === "dm"
              ? { scenes: this.listScenes(), activeSceneId: this.activeSceneId() }
              : {}),
            templates: this.listTemplates(),
            characters: this.listCharacters(),
            messages: page.messages,
            hasMoreMessages: page.hasMore,
            notes: this.listNotes(),
          });
        }

        case "GET messages": {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const page = this.listMessages({
            limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 100) : 50,
            beforeCreatedAt: url.searchParams.get("before") ?? undefined,
            beforeId: url.searchParams.get("beforeId") ?? undefined,
          });
          return json(page);
        }

        case "POST message": {
          const message = this.createMessage({
            authorMemberId: memberId,
            authorName: memberName,
            kind: (body.kind as ChatMessage["kind"]) ?? "ooc",
            content: String(body.content ?? ""),
            visibility: (body.visibility as Visibility) ?? "public",
            recipientMemberIds: (body.recipientMemberIds as string[]) ?? [],
          });
          this.broadcastMessage(message);
          return json(message);
        }

        case "POST roll": {
          if (!this.canEditCharacter(String(body.characterId), memberId, role))
            return json({ error: "You cannot roll for this character" }, 403);
          const evaluated = this.rollFor(String(body.characterId), String(body.rollId));
          if (!evaluated) return json({ error: "Roll not found" }, 404);
          const visibility = (body.visibility as Visibility) ?? evaluated.definition.visibility;
          const message = this.createMessage({
            authorMemberId: memberId,
            authorName: memberName,
            kind: "roll",
            content: `${evaluated.definition.label}`,
            visibility,
            recipientMemberIds: (body.recipientMemberIds as string[]) ?? [],
            roll: evaluated.result,
            authorAvatarKey: evaluated.character.avatarKey,
            characterId: evaluated.character.id,
          });
          this.broadcastMessage(message);
          return json(message);
        }

        case "POST character": {
          const decoded = Schema.decodeUnknownResult(SaveCharacterInput)(body);
          if (decoded._tag === "Failure") return json({ error: "Invalid character" }, 400);
          if (!this.canSaveCharacter(decoded.success, memberId, role))
            return json({ error: "You cannot edit this character" }, 403);
          const error = characterValuesError(decoded.success.values);
          if (error) return json({ error }, 400);
          const character = this.saveCharacter({
            ...decoded.success,
            memberId:
              decoded.success.memberId ??
              (decoded.success.id ? this.getCharacter(decoded.success.id)?.memberId : undefined) ??
              memberId,
          });
          this.broadcast({ type: "character", character });
          return json(character);
        }

        case "POST character/avatar": {
          const characterId = String(body.characterId ?? "");
          const avatarKey = body.avatarKey === null ? undefined : String(body.avatarKey ?? "");
          if (!characterId || avatarKey === "") return json({ error: "Missing avatar" }, 400);
          if (!this.canEditCharacter(characterId, memberId, role))
            return json({ error: "You cannot edit this character" }, 403);
          const character = this.setCharacterAvatar(characterId, avatarKey);
          if (!character) return json({ error: "Character not found" }, 404);
          this.broadcast({ type: "character", character });
          return json(character);
        }

        case "POST ticker": {
          if (!this.canEditCharacter(String(body.characterId), memberId, role))
            return json({ error: "You cannot edit this character" }, 403);
          if (!Number.isSafeInteger(body.value))
            return json({ error: "Invalid tracker value" }, 400);
          const character = this.setTicker(
            String(body.characterId),
            String(body.tickerId),
            Number(body.value),
          );
          if (!character) return json({ error: "Character not found" }, 404);
          this.broadcast({ type: "character", character });
          return json(character);
        }

        case "POST template": {
          if (role !== "dm") return json({ error: "Only the DM can save templates" }, 403);
          const input = Schema.decodeUnknownResult(SaveTemplateInput)(body);
          if (input._tag === "Failure") return json({ error: "Invalid template data" }, 400);
          const error = layoutLimitsError(input.success.layout);
          if (error) return json({ error }, 400);
          return json(this.saveTemplate(input.success));
        }

        case "POST note": {
          const result = await this.saveNote(
            {
              id: body.id as string | undefined,
              title: String(body.title ?? "Untitled"),
              visibility: (body.visibility as Visibility) ?? "private",
              content: String(body.content ?? ""),
              editableByAll:
                typeof body.editableByAll === "boolean" ? body.editableByAll : undefined,
              ownerMemberId: memberId,
            },
            request.headers.get("x-ttrpg-role") === "dm" ? "dm" : "player",
          );
          if ("forbidden" in result) {
            return json({ error: "You cannot make these changes to this note" }, 403);
          }
          return json(result.note);
        }

        case "GET notes":
          return json(this.listNotes());

        default:
          break;
      }

      const noteMatch = /^notes\/([^/]+)$/.exec(path);
      if (noteMatch && request.method === "GET") {
        const note = await this.getNote(noteMatch[1]);
        return note ? json(note) : json({ error: "Not found" }, 404);
      }
      if (noteMatch && request.method === "DELETE") {
        const result = await this.deleteNote(noteMatch[1], memberId);
        if ("forbidden" in result) {
          return json({ error: "Only the author can delete this note" }, 403);
        }
        return json({ ok: true });
      }

      const characterMatch = /^character\/([^/]+)$/.exec(path);
      if (characterMatch && request.method === "GET") {
        const character = this.getCharacter(characterMatch[1]);
        return character ? json(character) : json({ error: "Not found" }, 404);
      }
      if (characterMatch && request.method === "DELETE") {
        if (!canEditCharacter(this.getCharacter(characterMatch[1]), memberId, role, "delete"))
          return json({ error: "You cannot delete this character" }, 403);
        this.deleteCharacter(characterMatch[1]);
        return json({ ok: true });
      }

      return json({ error: `Unknown endpoint ${request.method} /${path}` }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // Hibernatable websocket handlers
  // -------------------------------------------------------------------------

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" } satisfies ServerFrame));
      return;
    }
    const decoded = Schema.decodeUnknownResult(ClientFrame)(parsed);
    if (decoded._tag === "Failure") {
      const searchRequest =
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        parsed.type === "search" &&
        "requestId" in parsed &&
        typeof parsed.requestId === "string"
          ? parsed.requestId
          : undefined;
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Invalid frame",
          ...(searchRequest === undefined ? {} : { code: "search", requestId: searchRequest }),
          ...(typeof parsed === "object" &&
          parsed !== null &&
          "type" in parsed &&
          parsed.type === "roll.table"
            ? { code: "roll" }
            : {}),
        } satisfies ServerFrame),
      );
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const frame = decoded.success;

    if (frame.type === "search") {
      try {
        socket.send(
          JSON.stringify({
            type: "search.result",
            requestId: frame.requestId,
            results: this.compendium.search(frame, attachment.role),
          } satisfies ServerFrame),
        );
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "search",
            requestId: frame.requestId,
            message: "Compendium search failed",
          } satisfies ServerFrame),
        );
      }
      return;
    }

    if (frame.type === "board.focus") {
      if (attachment.role !== "dm") {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Only the DM can focus the board",
          } satisfies ServerFrame),
        );
        return;
      }
      if (frame.sceneId !== undefined && frame.sceneId !== this.activeSceneId()) return;
      this.broadcast(
        {
          type: "board.focus",
          sceneId: this.activeSceneId(),
          rect: frame.rect,
          from: attachment.name,
        },
        (_session, connection) => connection !== socket,
      );
      return;
    }

    if (frame.type === "cursors.subscribe") {
      attachment.cursorId ??= newId("cursor");
      attachment.cursorsEnabled = frame.enabled;
      socket.serializeAttachment(attachment);
      if (!frame.enabled) this.broadcastCursor(attachment, null);
      return;
    }

    if (frame.type === "cursor") {
      if (!attachment.cursorsEnabled) return;
      const now = Date.now();
      if (frame.position && now - (attachment.lastCursorAt ?? 0) < 30) return;
      attachment.lastCursorAt = frame.position ? now : 0;
      socket.serializeAttachment(attachment);
      this.broadcastCursor(attachment, frame.position);
      return;
    }

    if (frame.type === "ping") {
      return;
    }

    if (frame.type === "chat") {
      if (!frame.content.trim()) return;
      const message = this.createMessage({
        authorMemberId: attachment.memberId,
        authorName: attachment.name,
        kind: frame.kind,
        content: frame.content.trim(),
        visibility: frame.visibility,
        recipientMemberIds: frame.recipientMemberIds,
      });
      this.broadcastMessage(message);
      return;
    }

    if (frame.type === "roll") {
      if (!this.canEditCharacter(frame.characterId, attachment.memberId, attachment.role)) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "roll",
            message: "You cannot roll for this character",
          } satisfies ServerFrame),
        );
        return;
      }
      const evaluated = this.rollFor(frame.characterId, frame.rollId);
      if (!evaluated) return;
      const message = this.createMessage({
        authorMemberId: attachment.memberId,
        authorName: attachment.name,
        kind: "roll",
        content: `${evaluated.definition.label}`,
        visibility: frame.visibility,
        recipientMemberIds: frame.recipientMemberIds,
        roll: evaluated.result,
        authorAvatarKey: evaluated.character.avatarKey,
        characterId: evaluated.character.id,
      });
      this.broadcastMessage(message);
      return;
    }

    if (frame.type === "roll.dice" || frame.type === "roll.table") {
      let result: Parsed<ChatMessage>;
      try {
        result =
          frame.type === "roll.table"
            ? await this.tableRoll(frame, attachment)
            : this.directRoll(frame, attachment);
      } catch {
        result = { ok: false, error: "Roll failed" };
      }
      if (result.ok) this.broadcastMessage(result.value);
      else
        socket.send(
          JSON.stringify({
            type: "error",
            code: "roll",
            message: result.error,
          } satisfies ServerFrame),
        );
      return;
    }

    if (frame.type === "character.lock") {
      if (attachment.role !== "dm") {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Only the DM can lock shared sheets",
          } satisfies ServerFrame),
        );
        return;
      }
      const character = this.getCharacter(frame.characterId);
      if (!character || character.scope !== "world") {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Shared sheet not found",
          } satisfies ServerFrame),
        );
        return;
      }
      const updated: Character = { ...character, locked: frame.locked, updatedAt: nowIso() };
      this.ctx.storage.sql.exec(
        "UPDATE characters SET locked = ?, updated_at = ? WHERE id = ?",
        frame.locked ? 1 : 0,
        updated.updatedAt,
        character.id,
      );
      this.broadcast({ type: "character", character: updated });
      return;
    }

    if (frame.type === "character.save") {
      if (!this.canSaveCharacter(frame.character, attachment.memberId, attachment.role)) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "You cannot edit this character",
          } satisfies ServerFrame),
        );
        return;
      }
      const error = characterValuesError(frame.character.values);
      if (error) {
        socket.send(JSON.stringify({ type: "error", message: error } satisfies ServerFrame));
        return;
      }
      const character = this.saveCharacter({
        id: frame.character.id,
        name: frame.character.name,
        templateId: frame.character.templateId,
        memberId: frame.character.memberId || attachment.memberId,
        values: frame.character.values,
        tickerMax: frame.character.tickerMax,
        scope: frame.character.scope,
      });
      this.broadcast({ type: "character", character });
      return;
    }

    if (frame.type === "character.value" || frame.type === "character.prefs") {
      if (!this.canEditCharacter(frame.characterId, attachment.memberId, attachment.role)) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "You cannot edit this character",
          } satisfies ServerFrame),
        );
        return;
      }
      const result =
        frame.type === "character.value"
          ? this.setCharacterValue(frame.characterId, frame.key, frame.value)
          : this.setLayoutPref(frame.characterId, frame.blockId, frame.variant);
      if ("error" in result)
        socket.send(JSON.stringify({ type: "error", message: result.error } satisfies ServerFrame));
      else
        this.broadcast({
          type: "character",
          character: result.character,
          requestId: frame.type === "character.value" ? frame.requestId : undefined,
        });
      return;
    }

    if (frame.type === "ticker.set") {
      if (!this.canEditCharacter(frame.characterId, attachment.memberId, attachment.role)) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "You cannot edit this character",
          } satisfies ServerFrame),
        );
        return;
      }
      const character = this.setTicker(frame.characterId, frame.tickerId, frame.value);
      if (character) this.broadcast({ type: "character", character, requestId: frame.requestId });
      else
        socket.send(
          JSON.stringify({ type: "error", message: "Tracker not found" } satisfies ServerFrame),
        );
      return;
    }

    if (frame.type === "note.saved") {
      socket.send(
        JSON.stringify({ type: "presence", members: this.presence() } satisfies ServerFrame),
      );
      const row = this.ctx.storage.sql
        .exec<NoteRow>("SELECT * FROM notes WHERE id = ?", frame.noteId)
        .toArray()[0];
      if (
        row &&
        canSeeNote(this.toNoteSummary(row), { id: attachment.memberId, role: attachment.role })
      ) {
        this.broadcastNotes(undefined, this.toNoteSummary(row));
      }
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    socket.serializeAttachment(null);
    if (attachment) this.broadcastCursor(attachment, null);
    socket.close(code, reason);
    this.broadcast({ type: "presence", members: this.presence() });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    socket.serializeAttachment(null);
    if (attachment) this.broadcastCursor(attachment, null);
    this.broadcast({ type: "presence", members: this.presence() });
  }
}
