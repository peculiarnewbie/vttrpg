import { canSeeNote, canSaveNote } from "../domain/note-permissions";
import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";
import { layoutLimitsError } from "../domain/template-io";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Semaphore from "effect/Semaphore";
import { toReply } from "./reply";
import { WorldStorage, WorldBucket, Broadcast, WorldId, type Caller } from "./world-rpc";
import {
  BadRequest,
  Forbidden,
  NotFound,
  Unauthorized,
  Unavailable,
  type ApiError,
} from "./services";
import { corpusApiError } from "./corpus-env";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { SheetLayout, type ListRow } from "../domain/sheet-layout";
import { notationRefs, parseNotation, rollNotation } from "../domain/dice-notation";
import { refValues, sheetRefLookup } from "../domain/sheet-refs";
import { WorldCompendium, type PreparedSourceImport } from "./world-compendium";
import type { CompendiumEntry, EntryType, PackEntry } from "../domain/compendium";
import { WorldSources, CorpusBucket, CorpusAccountId } from "./world-sources";
import { CorpusClient, corpusClient, corpusEnabled, type CorpusBindings } from "./corpus-env";
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
  SceneMetadata,
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

const storedJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string | null,
  fallback: S["Type"],
): S["Type"] => {
  if (value === null) return fallback;
  try {
    const result = Schema.decodeUnknownResult(schema)(JSON.parse(value));
    return result._tag === "Success" ? result.success : fallback;
  } catch {
    return fallback;
  }
};

const layoutPrefLimits = { blockId: 80, variant: 40, count: 200 };
const LayoutPrefs = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.isMaxLength(layoutPrefLimits.variant)),
).check(
  Schema.isMaxProperties(layoutPrefLimits.count),
  Schema.makeFilter(
    (prefs) => Object.keys(prefs).every((key) => key.length <= layoutPrefLimits.blockId),
    {
      expected: "Block ids of 80 characters or fewer",
    },
  ),
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

export const SaveWorldCharacterInput = SaveCharacterInput.check(
  Schema.makeFilter((input) => characterValuesError(input.values)),
);
export const SaveWorldTemplateInput = SaveTemplateInput.check(
  Schema.makeFilter((input) => layoutLimitsError(input.layout)),
);
const WorldClientFrame = ClientFrame.check(
  Schema.makeFilter((frame) => {
    if (frame.type === "character.save") return characterValuesError(frame.character.values);
    if (frame.type === "character.prefs") {
      if (frame.blockId.length > layoutPrefLimits.blockId)
        return "Block ids must be 80 characters or fewer";
      if (frame.variant !== null && frame.variant.length > layoutPrefLimits.variant)
        return "Layout variants must be 40 characters or fewer";
    }
  }),
);
// Root checks carry the existing messages; malformed shapes keep the transport's generic error.
export const inputMessage = (error: Schema.SchemaError, fallback: string): string =>
  error.issue._tag === "Filter" ||
  (error.issue._tag === "Composite" && error.issue.issues.every((issue) => issue._tag === "Filter"))
    ? error.message
    : fallback;

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

type BroadcastFilter = (session: SocketAttachment, socket: WebSocket) => boolean;
class WorldEvents extends Context.Service<
  WorldEvents,
  {
    readonly broadcast: (frame: ServerFrame, filter?: BroadcastFilter) => void;
  }
>()("ttrpg/WorldEvents") {}
class WorldLogic extends Context.Service<WorldLogic, WorldOperations>()("ttrpg/WorldLogic") {}

const worldIO = <T>(operation: () => Promise<T>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(Effect.fail(new Unavailable({ message: "World service unavailable" }))),
      ),
    ),
  );
const worldSync = <T>(operation: () => T) =>
  Effect.try({ try: operation, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(Effect.fail(new Unavailable({ message: "World service unavailable" }))),
      ),
    ),
  );
const requireDm = (caller: Caller, message: string) =>
  caller.role === "dm" ? Effect.void : Effect.fail(new Forbidden({ message }));

type WorldContent = Omit<
  WorldCompendium,
  "ensureMigrated" | "lookup" | "setSources" | "handle" | "checkRequest"
> & {
  ensureMigrated(): Effect.Effect<void, ApiError>;
  lookup(
    id: string,
    role: string,
  ): Effect.Effect<{ entry: CompendiumEntry; type: EntryType } | undefined, ApiError>;
  setSources(sources: {
    available: boolean;
    ownsType(id: string): boolean;
    resolve(id: string, role: string): Effect.Effect<CompendiumEntry | undefined, ApiError>;
    bodies(
      ids: readonly string[],
      role: string,
    ): Effect.Effect<ReadonlyMap<string, CompendiumEntry>, ApiError>;
    exportEntries(): Effect.Effect<CompendiumEntry[], ApiError>;
    prepareImport(entries: readonly PackEntry[]): Effect.Effect<PreparedSourceImport, ApiError>;
  }): void;
  checkRequest(method: string, path: string, role: string): Effect.Effect<void, ApiError>;
  handle(
    method: string,
    path: string,
    body: unknown,
    role: string,
    worldName: string,
    since: string | null,
  ): Effect.Effect<unknown, ApiError>;
};

class WorldOperations {
  private constructor(
    private readonly storage: typeof WorldStorage.Service,
    private readonly bucket: typeof WorldBucket.Service,
    readonly worldId: string,
    private readonly broadcast: (typeof WorldEvents.Service)["broadcast"],
    readonly compendium: WorldContent,
    readonly sources: WorldSources,
  ) {}
  static make = Effect.gen(function* () {
    const storage = yield* WorldStorage;
    const bucket = yield* WorldBucket;
    const worldId = yield* WorldId;
    const broadcast = yield* Broadcast;
    const events = yield* WorldEvents;
    const compendium: WorldContent = new WorldCompendium({
      sql: storage.sql,
      transactionSync: storage.transactionSync,
      bucket,
      worldId,
      broadcast,
    });
    const sources = yield* WorldSources.make(compendium);
    compendium.setSources({
      available: sources.available,
      ownsType: (id) => sources.ownsType(id),
      resolve: (id, role) => sources.resolve(id, role).pipe(Effect.mapError(corpusApiError)),
      bodies: (ids, role) => sources.bodies(ids, role).pipe(Effect.mapError(corpusApiError)),
      exportEntries: () => sources.exportEntries().pipe(Effect.mapError(corpusApiError)),
      prepareImport: (entries) =>
        sources.prepareImport(entries).pipe(Effect.mapError(corpusApiError)),
    });
    return new WorldOperations(storage, bucket, worldId, events.broadcast, compendium, sources);
  });
  initialize = () =>
    Effect.gen({ self: this }, function* () {
      yield* worldSync(() => this.ensureSchema());
      yield* this.sources.migrate().pipe(Effect.mapError(corpusApiError));
      yield* this.compendium.ensureMigrated();
    });

  private activeSceneId(): string {
    return this.storage.sql
      .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'active_scene_id'")
      .one().value;
  }

  private getBoard(sceneId = this.activeSceneId()): BoardSnapshot {
    const row = this.storage.sql
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
    return this.storage.sql
      .exec<{
        id: string;
        name: string;
        sort: number;
        group_name: string | null;
        revision: number;
        element_count: number;
        updated_at: string;
      }>(
        "SELECT id, name, sort, group_name, updated_at, json_extract(snapshot, '$.revision') AS revision, json_array_length(snapshot, '$.document.elements') AS element_count FROM scenes ORDER BY sort, id",
      )
      .toArray()
      .map((row) =>
        Schema.decodeUnknownSync(SceneMetadata)({
          id: row.id,
          name: row.name,
          sort: row.sort,
          group: row.group_name,
          updatedAt: row.updated_at,
          revision: row.revision,
          elementCount: row.element_count,
        }),
      );
  }

  private boardFrame(
    sceneId: string,
    role: string,
    board = this.getBoard(sceneId),
  ): Extract<ServerFrame, { type: "board" }> {
    return {
      type: "board",
      sceneId,
      sceneName: board.sceneName ?? "Scene",
      activeSceneId: this.activeSceneId(),
      board: role === "dm" ? board : stripHiddenLayers(board),
    };
  }

  private broadcastBoard(sceneId: string, board = this.getBoard(sceneId)) {
    const frame = this.boardFrame(sceneId, "dm", board);
    this.broadcast(frame, (session) => session.role === "dm");
    if (sceneId === frame.activeSceneId)
      this.broadcast(
        { ...frame, board: stripHiddenLayers(frame.board) },
        (session) => session.role !== "dm",
      );
    this.broadcastScenes();
  }

  private broadcastScenes() {
    this.broadcast(
      { type: "scenes", scenes: this.listScenes(), activeSceneId: this.activeSceneId() },
      (session) => session.role === "dm",
    );
  }

  private ensureSchema() {
    const sql = this.storage.sql;
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
    const existing = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM templates").one();
    if (!existing || existing.n === 0) this.insertTemplate(defaultTemplate(this.worldId));
  }

  private ensureColumn(table: string, column: string, ddl: string) {
    const columns = this.storage.sql
      .exec<{ name: string }>(`PRAGMA table_info(${table})`)
      .toArray();
    if (!columns.some((existing) => existing.name === column)) {
      this.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  // -------------------------------------------------------------------------
  // Row mapping
  // -------------------------------------------------------------------------

  private toTemplate(row: TemplateRow): SheetTemplate {
    return {
      id: row.id,
      worldId: this.worldId,
      name: row.name,
      description: row.description ?? undefined,
      fields: storedJson(SheetTemplate.fields.fields, row.fields, []),
      stats: storedJson(SheetTemplate.fields.stats, row.stats, []),
      tickers: storedJson(SheetTemplate.fields.tickers, row.tickers, []),
      rolls: storedJson(SheetTemplate.fields.rolls, row.rolls, []),
      layout: storedJson(Schema.UndefinedOr(SheetLayout), row.layout, undefined),
      updatedAt: row.updated_at,
    };
  }
  private toCharacter(row: CharacterRow): Character {
    return {
      id: row.id,
      worldId: this.worldId,
      memberId: row.member_id,
      name: row.name,
      templateId: row.template_id,
      values: storedJson(Character.fields.values, row.data, {}),
      tickers: storedJson(Character.fields.tickers, row.tickers, {}),
      tickerMax: storedJson(Character.fields.tickers, row.ticker_max, {}),
      layoutPrefs: storedJson(Schema.UndefinedOr(LayoutPrefs), row.layout_prefs, undefined),
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
      recipientMemberIds: storedJson(ChatMessage.fields.recipientMemberIds, row.recipient_ids, []),
      roll: storedJson(Schema.UndefinedOr(RollResult), row.roll, undefined),
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
    const rows = this.storage.sql
      .exec<TemplateRow>("SELECT * FROM templates ORDER BY updated_at DESC")
      .toArray();
    return rows.map((row) => this.toTemplate(row));
  }

  private getTemplate(id?: string): SheetTemplate | undefined {
    const rows = id
      ? this.storage.sql
          .exec<TemplateRow>("SELECT * FROM templates WHERE id = ? LIMIT 1", id)
          .toArray()
      : this.storage.sql
          .exec<TemplateRow>("SELECT * FROM templates ORDER BY updated_at DESC LIMIT 1")
          .toArray();
    return rows[0] ? this.toTemplate(rows[0]) : undefined;
  }

  private listCharacters(): Character[] {
    const rows = this.storage.sql
      .exec<CharacterRow>("SELECT * FROM characters ORDER BY created_at ASC")
      .toArray();
    return rows.map((row) => this.toCharacter(row));
  }

  private getCharacter(id: string): Character | undefined {
    const rows = this.storage.sql
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
    const rows = this.storage.sql
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
    const rows = this.storage.sql
      .exec<NoteRow>("SELECT * FROM notes ORDER BY updated_at DESC")
      .toArray();
    return rows.map((row) => this.toNoteSummary(row));
  }

  private readNote = (id: string) =>
    Effect.gen({ self: this }, function* () {
      const row = this.storage.sql
        .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
        .toArray()[0];
      if (!row) return yield* new NotFound({ message: "Not found" });
      const object = yield* worldIO(() => this.bucket.get(row.r2_key));
      const content = object ? yield* worldIO(() => object.text()) : "";
      return { ...this.toNoteSummary(row), content };
    });

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private insertTemplate(template: SheetTemplate) {
    this.storage.sql.exec(
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

  private saveTemplateRow(input: SaveTemplateInput & { id?: string }): SheetTemplate {
    const id = input.id ?? newId("tpl");
    const existing = this.storage.sql
      .exec("SELECT id FROM templates WHERE id = ? LIMIT 1", id)
      .toArray()[0];
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
      this.storage.sql.exec(
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

  private saveCharacterRow(input: SaveCharacterInput, existing?: Character): Character {
    const now = nowIso();
    const id = input.id ?? newId("chr");
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
      this.storage.sql.exec(
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
      this.storage.sql.exec(
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

  private deleteCharacterRow(id: string) {
    this.storage.sql.exec("DELETE FROM characters WHERE id = ?", id);
  }

  private setTickerRow(
    character: Character,
    tickerId: string,
    value: number,
  ): Character | undefined {
    const characterId = character.id;
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
    this.storage.sql.exec(
      "UPDATE characters SET tickers = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(updated.tickers),
      updated.updatedAt,
      characterId,
    );
    return updated;
  }

  private setCharacterValue = Effect.fn("World.setCharacterValue")(function* (
    this: WorldOperations,
    character: Character,
    key: string,
    value: Character["values"][string],
  ) {
    const characterId = character.id;
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    if (trackerDefinitions(template).some((tracker) => tracker.id === key))
      return yield* new BadRequest({ message: "Tracker values must be updated with ticker.set" });
    const values = { ...character.values, [key]: value };
    // A partial edit can exceed limits when combined with the current stored values.
    const error = characterValuesError(values);
    if (error) return yield* new BadRequest({ message: error });
    const updated: Character = { ...character, values, updatedAt: nowIso() };
    // No await between reading and writing: frames cannot overwrite each other's keys.
    this.storage.sql.exec(
      "UPDATE characters SET data = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(values),
      updated.updatedAt,
      characterId,
    );
    return updated;
  });

  private setLayoutPref = Effect.fn("World.setLayoutPref")(function* (
    this: WorldOperations,
    character: Character,
    blockId: string,
    variant: string | null,
  ) {
    const characterId = character.id;

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
      return yield* new BadRequest({ message: "Layout block not found" });
    const layoutPrefs =
      variant === null
        ? { ...character.layoutPrefs }
        : { ...character.layoutPrefs, [blockId]: variant };
    if (variant === null) delete layoutPrefs[blockId];
    if (Object.keys(layoutPrefs).length > layoutPrefLimits.count)
      return yield* new BadRequest({
        message: "Layout preferences must contain at most 200 entries",
      });
    const updated: Character = { ...character, layoutPrefs, updatedAt: nowIso() };
    this.storage.sql.exec(
      "UPDATE characters SET layout_prefs = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(layoutPrefs),
      updated.updatedAt,
      characterId,
    );
    return updated;
  });

  private setCharacterAvatar(character: Character, avatarKey: string | undefined): Character {
    const characterId = character.id;
    const updated: Character = { ...character, avatarKey, updatedAt: nowIso() };
    this.storage.sql.exec(
      "UPDATE characters SET avatar_key = ?, updated_at = ? WHERE id = ?",
      avatarKey ?? null,
      updated.updatedAt,
      characterId,
    );
    return updated;
  }

  private characterForMember(memberId: string): Character | undefined {
    const rows = this.storage.sql
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
    this.storage.sql.exec(
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

  private directRoll = Effect.fn("World.directRoll")(function* (
    this: WorldOperations,
    frame: Extract<ClientFrame, { type: "roll.dice" }>,
    attachment: SocketAttachment,
  ) {
    // parseRollCommand lowercases refs; strip the prefix from the original instead.
    const cleaned =
      parseRollCommand(frame.notation) === null
        ? frame.notation
        : frame.notation.trim().replace(/^\/roll\s*/i, "");
    const parsed = parseNotation(cleaned);
    if (!parsed.ok) return yield* new BadRequest({ message: parsed.error });

    let character: Character | undefined;
    if (notationRefs(parsed.value).length || frame.characterId !== undefined) {
      // `/roll 1d20 + @str_mod` in chat reads the sender's own character.
      character =
        frame.characterId === undefined
          ? this.characterForMember(attachment.memberId)
          : this.getCharacter(frame.characterId);
      if (!character)
        return yield* frame.characterId === undefined
          ? new BadRequest({ message: "Choose a character to roll sheet values" })
          : new NotFound({ message: "Character not found" });
      yield* this.requireCharacter(
        { memberId: attachment.memberId, displayName: attachment.name, role: attachment.role },
        character,
        "edit",
        "You cannot roll for this character",
      );
    }

    let row: ListRow | undefined;
    if (frame.row !== undefined) {
      const rows = character?.values[frame.row.key];
      const selected = Array.isArray(rows) ? rows[frame.row.index] : undefined;
      if (typeof selected !== "object" || selected === null || Array.isArray(selected))
        return yield* new NotFound({ message: "List row not found" });
      row = selected;
    }
    const layout = character ? this.getTemplate(character.templateId)?.layout : undefined;
    const rolled = rollNotation(parsed.value, {
      lookup: character
        ? sheetRefLookup(layout, refValues(layout, character.values, character.tickers), row)
        : undefined,
    });
    if (!rolled.ok) return yield* new BadRequest({ message: rolled.error });

    const authorCharacter = character ?? this.characterForMember(attachment.memberId);
    return this.createMessage({
      authorMemberId: attachment.memberId,
      authorName: attachment.name,
      kind: "roll",
      content: (frame.label ?? "").trim(),
      visibility: frame.visibility,
      recipientMemberIds: frame.recipientMemberIds ?? [],
      roll: rolled.value,
      authorAvatarKey: authorCharacter?.avatarKey,
      characterId: authorCharacter?.id,
    });
  });

  private tableRoll = Effect.fn("World.tableRoll")(function* (
    this: WorldOperations,
    frame: Extract<ClientFrame, { type: "roll.table" }>,
    attachment: SocketAttachment,
  ) {
    const found = yield* this.compendium.lookup(frame.entryId, attachment.role);
    if (!found) return yield* new NotFound({ message: "Entry not found" });
    const { entry, type } = found;
    const field = type.fields.find((field) => field.key === frame.field);
    if (field?.kind !== "oracle" || !field.dice)
      return yield* new NotFound({ message: "Oracle field not found" });
    const parsed = parseNotation(field.dice);
    if (!parsed.ok) return yield* new BadRequest({ message: parsed.error });
    if (notationRefs(parsed.value).length)
      return yield* new BadRequest({ message: "Oracle dice cannot use sheet references" });
    const rows = oracleRows(entry.fields[field.key]);
    if (!rows.ok) return yield* new BadRequest({ message: rows.error });
    const rolled = rollNotation(parsed.value);
    if (!rolled.ok) return yield* new BadRequest({ message: rolled.error });
    return this.createMessage({
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
    });
  });

  private rollFor(characterId: string, rollId: string, character = this.getCharacter(characterId)) {
    if (!character) return undefined;
    const template = this.getTemplate(character.templateId) ?? this.getTemplate();
    if (!template) return undefined;
    const definition = template.rolls.find((roll) => roll.id === rollId);
    if (!definition) return undefined;
    const stats = computeStats(template.stats, character.values);
    const resolver = makeResolver(character.values, stats);
    return { character, definition, result: evaluateRoll(definition, resolver) };
  }

  private readonly noteWrites = Semaphore.makeUnsafe(1);

  saveNote = (caller: Caller, input: SaveNoteInput) =>
    this.noteWrites.withPermit(
      Effect.gen({ self: this }, function* () {
        // R2 awaits allow other requests to run; serialize permission checks and writes.
        const id = input.id ?? newId("note");
        const existing = this.storage.sql
          .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
          .toArray()[0];
        const previous = existing ? this.toNoteSummary(existing) : undefined;
        if (previous && !canSaveNote(previous, input, { id: caller.memberId, role: caller.role }))
          return yield* new Forbidden({ message: "You cannot make these changes to this note" });
        const editableByAll = input.editableByAll ?? existing?.editable_by_all === 1;
        const key = existing?.r2_key ?? `world/${this.worldId}/notes/${id}.md`;
        yield* worldIO(() =>
          this.bucket.put(key, input.content, {
            httpMetadata: { contentType: "text/markdown; charset=utf-8" },
          }),
        );
        const updatedAt = nowIso();
        this.storage.transactionSync(() => {
          if (existing)
            this.storage.sql.exec(
              "UPDATE notes SET title = ?, visibility = ?, editable_by_all = ?, updated_at = ? WHERE id = ?",
              input.title,
              input.visibility,
              editableByAll ? 1 : 0,
              updatedAt,
              id,
            );
          else
            this.storage.sql.exec(
              "INSERT INTO notes (id, title, owner_member_id, visibility, r2_key, updated_at, editable_by_all) VALUES (?, ?, ?, ?, ?, ?, ?)",
              id,
              input.title,
              caller.memberId,
              input.visibility,
              key,
              updatedAt,
              editableByAll ? 1 : 0,
            );
        });
        const note: Note = {
          id,
          title: input.title,
          ownerMemberId: existing?.owner_member_id ?? caller.memberId,
          visibility: input.visibility,
          editableByAll,
          content: input.content,
          updatedAt,
        };
        this.broadcastNotes(previous, note);
        return note;
      }),
    );

  deleteNote = (caller: Caller, id: string) =>
    this.noteWrites.withPermit(
      Effect.gen({ self: this }, function* () {
        const row = this.storage.sql
          .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
          .toArray()[0];
        if (row && row.owner_member_id !== caller.memberId)
          return yield* new Forbidden({ message: "Only the author can delete this note" });
        if (row) yield* worldIO(() => this.bucket.delete(row.r2_key));
        this.storage.sql.exec("DELETE FROM notes WHERE id = ?", id);
        if (row) this.broadcastNotes(this.toNoteSummary(row));
        return { ok: true };
      }),
    );
  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  private broadcastNotes(previous?: NoteSummary, current?: NoteSummary) {
    this.broadcast({ type: "notes.updated" }, (session) => {
      const viewer = { id: session.memberId, role: session.role };
      return !!(
        (previous && canSeeNote(previous, viewer)) ||
        (current && canSeeNote(current, viewer))
      );
    });
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

  private broadcastMessage(message: ChatMessage) {
    this.broadcast({ type: "message", message }, (session) => this.visibleTo(message, session));
  }

  private requireCharacter(
    caller: Caller,
    character: Character | undefined,
    action: "edit" | "delete" = "edit",
    message = action === "delete"
      ? "You cannot delete this character"
      : "You cannot edit this character",
  ) {
    return canEditCharacter(character, caller.memberId, caller.role, action)
      ? Effect.void
      : Effect.fail(new Forbidden({ message }));
  }

  state = (caller: Caller) =>
    worldSync(() => {
      const page = this.listMessages({ limit: 50 });
      const board = this.getBoard();
      return {
        board: caller.role === "dm" ? board : stripHiddenLayers(board),
        ...(caller.role === "dm"
          ? { scenes: this.listScenes(), activeSceneId: this.activeSceneId() }
          : {}),
        templates: this.listTemplates(),
        characters: this.listCharacters(),
        messages: page.messages,
        hasMoreMessages: page.hasMore,
        notes: this.listNotes(),
      };
    });
  messages = (
    _caller: Caller,
    input: { limit?: number; beforeCreatedAt?: string; beforeId?: string },
  ) => worldSync(() => this.listMessages(input));
  sendMessage = (caller: Caller, input: Extract<ClientFrame, { type: "chat" }>) =>
    Effect.sync(() => {
      const message = this.createMessage({
        authorMemberId: caller.memberId,
        authorName: caller.displayName,
        kind: input.kind,
        content: input.content,
        visibility: input.visibility,
        recipientMemberIds: input.recipientMemberIds,
      });
      this.broadcastMessage(message);
      return message;
    });
  roll = (caller: Caller, input: Extract<ClientFrame, { type: "roll" }>) =>
    Effect.gen({ self: this }, function* () {
      const character = this.getCharacter(input.characterId);
      yield* this.requireCharacter(caller, character, "edit", "You cannot roll for this character");
      const evaluated = this.rollFor(input.characterId, input.rollId, character);
      if (!evaluated) return yield* new NotFound({ message: "Roll not found" });
      const message = this.createMessage({
        authorMemberId: caller.memberId,
        authorName: caller.displayName,
        kind: "roll",
        content: evaluated.definition.label,
        visibility: input.visibility ?? evaluated.definition.visibility,
        recipientMemberIds: input.recipientMemberIds,
        roll: evaluated.result,
        authorAvatarKey: evaluated.character.avatarKey,
        characterId: evaluated.character.id,
      });
      this.broadcastMessage(message);
      return message;
    });
  saveCharacter = (caller: Caller, input: SaveCharacterInput) =>
    Effect.gen({ self: this }, function* () {
      const existing = input.id === undefined ? undefined : this.getCharacter(input.id);
      if (existing) yield* this.requireCharacter(caller, existing);
      if (
        caller.role !== "dm" &&
        existing?.scope !== "world" &&
        input.memberId !== undefined &&
        input.memberId !== caller.memberId
      )
        return yield* new Forbidden({ message: "You cannot edit this character" });
      const character = this.saveCharacterRow(
        {
          ...input,
          memberId: input.memberId ?? existing?.memberId ?? caller.memberId,
        },
        existing,
      );
      this.broadcast({ type: "character", character });
      return character;
    });
  setAvatar = (caller: Caller, input: { characterId: string; avatarKey: string | null }) =>
    Effect.gen({ self: this }, function* () {
      const existing = this.getCharacter(input.characterId);
      yield* this.requireCharacter(caller, existing);
      if (!existing) return yield* new NotFound({ message: "Character not found" });
      const character = this.setCharacterAvatar(existing, input.avatarKey ?? undefined);
      this.broadcast({ type: "character", character });
      return character;
    });
  setTicker = (
    caller: Caller,
    input: Extract<ClientFrame, { type: "ticker.set" }>,
    missing = "Character not found",
  ) =>
    Effect.gen({ self: this }, function* () {
      const existing = this.getCharacter(input.characterId);
      yield* this.requireCharacter(caller, existing);
      const character = existing && this.setTickerRow(existing, input.tickerId, input.value);
      if (!character) return yield* new NotFound({ message: missing });
      this.broadcast({ type: "character", character, requestId: input.requestId });
      return character;
    });
  saveTemplate = (caller: Caller, input: SaveTemplateInput) =>
    Effect.gen({ self: this }, function* () {
      yield* requireDm(caller, "Only the DM can save templates");
      return this.saveTemplateRow(input);
    });
  notes = (_caller: Caller) => Effect.sync(() => this.listNotes());
  note = (_caller: Caller, id: string) => this.readNote(id);
  character = (_caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      const character = this.getCharacter(id);
      if (!character) return yield* new NotFound({ message: "Not found" });
      return character;
    });
  deleteCharacter = (caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      yield* this.requireCharacter(caller, this.getCharacter(id), "delete");
      this.deleteCharacterRow(id);
      return { ok: true };
    });
  board = (caller: Caller) =>
    Effect.sync(() => {
      const board = this.getBoard();
      return caller.role === "dm" ? board : stripHiddenLayers(board);
    });
  private publish = (sceneId: string, input: typeof PublishBoardInput.Type) =>
    Effect.gen({ self: this }, function* () {
      // The board may have changed since the caller loaded it.
      if (input.sceneId !== undefined && input.sceneId !== sceneId)
        return yield* new BadRequest({
          message: "The active scene changed. Load it before publishing again.",
        });
      const current = this.getBoard(sceneId);
      if (input.revision !== current.revision)
        return yield* new BadRequest({
          message: "The shared board changed. Load the published board before publishing again.",
        });
      const board: BoardSnapshot = {
        sceneId,
        sceneName: current.sceneName,
        revision: current.revision + 1,
        document: normalizeBoard(input.document),
      };
      this.storage.sql.exec(
        "UPDATE scenes SET snapshot = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(board),
        nowIso(),
        sceneId,
      );
      this.broadcastBoard(sceneId, board);
      return board;
    });
  publishBoard = (caller: Caller, input: typeof PublishBoardInput.Type) =>
    Effect.gen({ self: this }, function* () {
      yield* requireDm(caller, "Only the DM can publish the board");
      return yield* this.publish(this.activeSceneId(), input);
    });
  scenes = (caller: Caller) =>
    Effect.gen({ self: this }, function* () {
      yield* requireDm(caller, "Only the DM can manage scenes");
      return { scenes: this.listScenes(), activeSceneId: this.activeSceneId() };
    });
  private requireScene = (caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      yield* requireDm(caller, "Only the DM can manage scenes");
      const scenes = this.listScenes();
      if (!scenes.some((scene) => scene.id === id))
        return yield* new NotFound({ message: "Scene not found" });
      return scenes;
    });
  createScene = (caller: Caller, input: typeof CreateSceneInput.Type) =>
    Effect.gen({ self: this }, function* () {
      yield* requireDm(caller, "Only the DM can manage scenes");
      const scenes = this.listScenes();
      if (scenes.length >= MAX_BOARD_SCENES)
        return yield* new BadRequest({ message: "A world can have at most 50 scenes" });
      if (input.duplicateFrom && !scenes.some((scene) => scene.id === input.duplicateFrom))
        return yield* new NotFound({ message: "Scene not found" });
      const document = input.duplicateFrom
        ? this.getBoard(input.duplicateFrom).document
        : normalizeBoard(emptyBoard().document);
      const id = crypto.randomUUID();
      this.storage.sql.exec(
        "INSERT INTO scenes (id, name, sort, group_name, snapshot, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
        id,
        input.name,
        scenes.length,
        JSON.stringify({ revision: 0, document }),
        nowIso(),
      );
      this.broadcastScenes();
      return { sceneId: id, sceneName: input.name, revision: 0, document };
    });
  scene = (caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      yield* this.requireScene(caller, id);
      return this.getBoard(id);
    });
  publishScene = (caller: Caller, id: string, input: typeof PublishBoardInput.Type) =>
    Effect.gen({ self: this }, function* () {
      yield* this.requireScene(caller, id);
      return yield* this.publish(id, input);
    });
  updateScene = (caller: Caller, id: string, input: typeof UpdateSceneInput.Type) =>
    Effect.gen({ self: this }, function* () {
      const scenes = yield* this.requireScene(caller, id);
      const current = this.getBoard(id);
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        if (input.name !== undefined)
          sql.exec("UPDATE scenes SET name = ? WHERE id = ?", input.name, id);
        if (input.group !== undefined)
          sql.exec("UPDATE scenes SET group_name = ? WHERE id = ?", input.group, id);
        if (input.sort !== undefined) {
          const order = scenes.map((scene) => scene.id).filter((sceneId) => sceneId !== id);
          order.splice(Math.min(input.sort, order.length), 0, id);
          order.forEach((sceneId, index) =>
            sql.exec("UPDATE scenes SET sort = ? WHERE id = ?", index, sceneId),
          );
        }
        sql.exec("UPDATE scenes SET updated_at = ? WHERE id = ?", nowIso(), id);
      });
      const board = { ...current, sceneName: input.name ?? current.sceneName };
      this.broadcastBoard(id, board);
      return board;
    });
  activateScene = (caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      yield* this.requireScene(caller, id);
      const board = this.getBoard(id);
      this.storage.sql.exec("UPDATE settings SET value = ? WHERE key = 'active_scene_id'", id);
      this.broadcastBoard(id, board);
      return board;
    });
  deleteScene = (caller: Caller, id: string) =>
    Effect.gen({ self: this }, function* () {
      const scenes = yield* this.requireScene(caller, id);
      if (scenes.length === 1)
        return yield* new BadRequest({ message: "Cannot delete the last scene" });
      const active = this.activeSceneId() === id;
      const remaining = scenes.filter((scene) => scene.id !== id);
      const neighbor =
        remaining[
          Math.min(
            scenes.findIndex((scene) => scene.id === id),
            remaining.length - 1,
          )
        ];
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec("DELETE FROM scenes WHERE id = ?", id);
        remaining.forEach((scene, index) =>
          sql.exec("UPDATE scenes SET sort = ? WHERE id = ?", index, scene.id),
        );
        if (active)
          sql.exec("UPDATE settings SET value = ? WHERE key = 'active_scene_id'", neighbor.id);
      });
      if (active) this.broadcastBoard(neighbor.id);
      else this.broadcastScenes();
      return { scenes: this.listScenes(), activeSceneId: this.activeSceneId() };
    });
  setCorpusAccount = (accountId: string) =>
    Effect.sync(() => {
      this.storage.sql.exec(
        "INSERT INTO settings (key,value) VALUES ('corpus_account_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value <> excluded.value",
        accountId,
      );
    });
  compendiumRequest = (caller: Caller, request: CompendiumRequest) =>
    Effect.gen({ self: this }, function* () {
      yield* this.setCorpusAccount(request.accountId);
      yield* this.compendium.checkRequest(request.method, request.path, caller.role);
      return yield* this.compendium.handle(
        request.method,
        request.path,
        request.body,
        caller.role,
        request.worldName,
        request.query.since ?? null,
      );
    });
  libraries = (caller: Caller, request: CompendiumRequest) =>
    Effect.gen({ self: this }, function* () {
      yield* this.setCorpusAccount(request.accountId);
      const result = yield* this.sources
        .handle(request.method, request.path, request.body, caller.role)
        .pipe(Effect.mapError(corpusApiError));
      yield* this.scheduleSourceCheck();
      return result;
    });
  scheduleSourceCheck = (retry = false) =>
    Effect.gen({ self: this }, function* () {
      const storage = this.storage.storage;
      if (
        !this.sources.enabled ||
        !this.storage.sql.exec("SELECT source_id FROM world_sources LIMIT 1").toArray().length
      ) {
        yield* worldIO(() => storage.deleteAlarm());
        return;
      }
      const last = Number(
        this.storage.sql
          .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'corpus_last_check'")
          .toArray()[0]?.value ?? 0,
      );
      const due = retry
        ? Date.now() + 15 * 60 * 1000
        : Math.max(Date.now() + 1000, last + 15 * 60 * 1000);
      const scheduled = yield* worldIO(() => storage.getAlarm());
      if (scheduled === null || due < scheduled) yield* worldIO(() => storage.setAlarm(due));
    });
  alarm = () =>
    Effect.gen({ self: this }, function* () {
      if (this.sources.enabled)
        yield* this.sources.check().pipe(Effect.catchCause(Effect.logError));
      yield* this.scheduleSourceCheck(true);
    });
  upgrade = (
    request: Request,
    presence: () => PresenceMember[],
    accept: (socket: WebSocket) => void,
  ) =>
    Effect.gen({ self: this }, function* () {
      const memberId = request.headers.get("x-ttrpg-member-id");
      if (!memberId) return yield* new Unauthorized({ message: "Missing identity" });
      const name = request.headers.get("x-ttrpg-member-name") ?? "Unknown";
      const role = (request.headers.get("x-ttrpg-role") as MemberRole | null) ?? "player";
      yield* this.scheduleSourceCheck().pipe(Effect.catchCause(Effect.logError));
      const pair = new WebSocketPair();
      const server = pair[1];
      accept(server);
      server.serializeAttachment({ memberId, name, role } satisfies SocketAttachment);
      server.send(
        JSON.stringify({
          type: "hello",
          worldId: this.worldId,
          member: {
            id: memberId,
            worldId: this.worldId,
            displayName: name,
            role,
            kind: "password",
            createdAt: nowIso(),
          },
          members: presence(),
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
      this.broadcast({ type: "presence", members: presence() });
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  frame = (
    socket: WebSocket,
    frame: ClientFrame,
    attachment: SocketAttachment,
    presence: () => PresenceMember[],
    cursor: (attachment: SocketAttachment, position: CursorPosition | null) => void,
  ) =>
    Effect.gen({ self: this }, function* () {
      const caller: Caller = {
        memberId: attachment.memberId,
        displayName: attachment.name,
        role: attachment.role,
      };
      switch (frame.type) {
        case "search":
          socket.send(
            JSON.stringify({
              type: "search.result",
              requestId: frame.requestId,
              results: this.compendium.search(frame, caller.role),
            } satisfies ServerFrame),
          );
          return;
        case "board.focus":
          yield* requireDm(caller, "Only the DM can focus the board");
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
        case "cursors.subscribe":
          attachment.cursorId ??= newId("cursor");
          attachment.cursorsEnabled = frame.enabled;
          socket.serializeAttachment(attachment);
          if (!frame.enabled) cursor(attachment, null);
          return;
        case "cursor": {
          if (!attachment.cursorsEnabled) return;
          const now = Date.now();
          if (frame.position && now - (attachment.lastCursorAt ?? 0) < 30) return;
          attachment.lastCursorAt = frame.position ? now : 0;
          socket.serializeAttachment(attachment);
          cursor(attachment, frame.position);
          return;
        }
        case "ping":
          return;
        case "chat":
          if (frame.content.trim())
            yield* this.sendMessage(caller, { ...frame, content: frame.content.trim() });
          return;
        case "roll":
          yield* this.roll(caller, frame).pipe(Effect.catchTag("NotFound", () => Effect.void));
          return;
        case "roll.dice":
        case "roll.table": {
          const operation =
            frame.type === "roll.table"
              ? this.tableRoll(frame, attachment)
              : this.directRoll(frame, attachment);
          const message = yield* operation;
          this.broadcastMessage(message);
          return;
        }
        case "character.lock": {
          yield* requireDm(caller, "Only the DM can lock shared sheets");
          const character = this.getCharacter(frame.characterId);
          if (!character || character.scope !== "world")
            return yield* new NotFound({ message: "Shared sheet not found" });
          const updated: Character = { ...character, locked: frame.locked, updatedAt: nowIso() };
          this.storage.sql.exec(
            "UPDATE characters SET locked = ?, updated_at = ? WHERE id = ?",
            frame.locked ? 1 : 0,
            updated.updatedAt,
            character.id,
          );
          this.broadcast({ type: "character", character: updated });
          return;
        }
        case "character.save":
          yield* this.saveCharacter(caller, {
            ...frame.character,
            memberId: frame.character.memberId || caller.memberId,
          });
          return;
        case "character.value":
        case "character.prefs": {
          const character = this.getCharacter(frame.characterId);
          yield* this.requireCharacter(caller, character);
          if (!character) return yield* new NotFound({ message: "Character not found" });
          const updated = yield* frame.type === "character.value"
            ? this.setCharacterValue(character, frame.key, frame.value)
            : this.setLayoutPref(character, frame.blockId, frame.variant);
          this.broadcast({
            type: "character",
            character: updated,
            requestId: frame.type === "character.value" ? frame.requestId : undefined,
          });
          return;
        }
        case "ticker.set":
          yield* this.setTicker(caller, frame, "Tracker not found");
          return;
        case "note.saved": {
          socket.send(
            JSON.stringify({ type: "presence", members: presence() } satisfies ServerFrame),
          );
          const row = this.storage.sql
            .exec<NoteRow>("SELECT * FROM notes WHERE id = ?", frame.noteId)
            .toArray()[0];
          const note = row ? this.toNoteSummary(row) : undefined;
          if (note && canSeeNote(note, { id: caller.memberId, role: caller.role }))
            this.broadcastNotes(undefined, note);
        }
      }
    });
}
export type CompendiumRequest = {
  readonly method: string;
  readonly path: string;
  readonly query: { readonly since?: string };
  readonly body?: unknown;
  readonly worldName: string;
  readonly accountId: string;
};

export class WorldDO extends DurableObject<WorldDoEnv> {
  private readonly runtime: ManagedRuntime.ManagedRuntime<WorldLogic, never>;

  constructor(ctx: DurableObjectState, env: WorldDoEnv) {
    super(ctx, env);
    const bindings = Layer.mergeAll(
      Layer.succeed(WorldStorage, {
        sql: ctx.storage.sql,
        storage: ctx.storage,
        transactionSync: (closure) => ctx.storage.transactionSync(closure),
      }),
      Layer.succeed(WorldBucket, env.BUCKET),
      Layer.succeed(WorldId, ctx.id.name?.replace(/^world:/, "") ?? "unknown"),
      Layer.succeed(Broadcast, (frame) => this.broadcast(frame)),
      Layer.succeed(WorldEvents, { broadcast: (frame, filter) => this.broadcast(frame, filter) }),
      Layer.succeed(CorpusClient, corpusClient(corpusEnabled(env) ? env.CORPUS : undefined)),
      Layer.succeed(CorpusBucket, corpusEnabled(env) ? env.CORPUS_BUCKET : undefined),
      Layer.succeed(
        CorpusAccountId,
        () =>
          ctx.storage.sql
            .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'corpus_account_id'")
            .toArray()[0]?.value ?? "",
      ),
    );
    this.runtime = ManagedRuntime.make(
      Layer.effect(WorldLogic, WorldOperations.make).pipe(Layer.provide(bindings)),
    );
    ctx.blockConcurrencyWhile(() =>
      this.runtime.runPromise(
        Effect.gen(function* () {
          const world = yield* WorldLogic;
          yield* world.initialize();
        }).pipe(Effect.tapCause(Effect.logError)),
      ),
    );
  }

  // RPC arguments are decoded and membership is resolved by the table HTTP edge.
  private reply<A>(effect: Effect.Effect<A, ApiError, WorldLogic>) {
    return toReply(effect, (operation) => this.runtime.runPromiseExit(operation));
  }
  state(caller: Caller) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.state(caller);
      }),
    );
  }
  messages(caller: Caller, input: { limit?: number; beforeCreatedAt?: string; beforeId?: string }) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.messages(caller, input);
      }),
    );
  }
  sendMessage(caller: Caller, input: Extract<ClientFrame, { type: "chat" }>) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.sendMessage(caller, input);
      }),
    );
  }
  roll(caller: Caller, input: Extract<ClientFrame, { type: "roll" }>) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.roll(caller, input);
      }),
    );
  }
  saveCharacter(caller: Caller, input: SaveCharacterInput) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.saveCharacter(caller, input);
      }),
    );
  }
  setAvatar(caller: Caller, input: { characterId: string; avatarKey: string | null }) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.setAvatar(caller, input);
      }),
    );
  }
  setTicker(caller: Caller, input: Extract<ClientFrame, { type: "ticker.set" }>) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.setTicker(caller, input);
      }),
    );
  }
  saveTemplate(caller: Caller, input: SaveTemplateInput) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.saveTemplate(caller, input);
      }),
    );
  }
  saveNote(caller: Caller, input: SaveNoteInput) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.saveNote(caller, input);
      }),
    );
  }
  notes(caller: Caller) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.notes(caller);
      }),
    );
  }
  note(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.note(caller, id);
      }),
    );
  }
  deleteNote(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.deleteNote(caller, id);
      }),
    );
  }
  character(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.character(caller, id);
      }),
    );
  }
  deleteCharacter(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.deleteCharacter(caller, id);
      }),
    );
  }
  board(caller: Caller) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.board(caller);
      }),
    );
  }
  publishBoard(caller: Caller, input: typeof PublishBoardInput.Type) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.publishBoard(caller, input);
      }),
    );
  }
  scenes(caller: Caller) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.scenes(caller);
      }),
    );
  }
  createScene(caller: Caller, input: typeof CreateSceneInput.Type) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.createScene(caller, input);
      }),
    );
  }
  scene(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.scene(caller, id);
      }),
    );
  }
  publishScene(caller: Caller, id: string, input: typeof PublishBoardInput.Type) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.publishScene(caller, id, input);
      }),
    );
  }
  updateScene(caller: Caller, id: string, input: typeof UpdateSceneInput.Type) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.updateScene(caller, id, input);
      }),
    );
  }
  deleteScene(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.deleteScene(caller, id);
      }),
    );
  }
  activateScene(caller: Caller, id: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.activateScene(caller, id);
      }),
    );
  }
  libraries(caller: Caller, request: CompendiumRequest) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.libraries(caller, request);
      }),
    );
  }
  compendium(caller: Caller, request: CompendiumRequest) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.compendiumRequest(caller, request);
      }),
    );
  }
  setCorpusAccount(_caller: Caller, accountId: string) {
    return this.reply(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        return yield* world.setCorpusAccount(accountId);
      }),
    );
  }
  fetch(request: Request): Promise<Response> {
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "Not found" }, 404);
        const world = yield* WorldLogic;
        return yield* world.upgrade(
          request,
          () => this.presence(),
          (socket) => this.ctx.acceptWebSocket(socket),
        );
      }).pipe(
        Effect.catchTag("Unauthorized", (error) =>
          Effect.succeed(json({ error: error.message }, 401)),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(cause).pipe(Effect.as(json({ error: "World service unavailable" }, 503))),
        ),
      ),
    );
  }
  alarm(): Promise<void> {
    return this.runtime.runPromise(
      Effect.gen(function* () {
        const world = yield* WorldLogic;
        yield* world.alarm();
      }).pipe(Effect.tapCause(Effect.logError)),
    );
  }
  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let frame: ClientFrame | undefined;
    let parsed: unknown;
    const operation = Effect.gen({ self: this }, function* () {
      parsed = yield* Effect.try({
        try: () =>
          JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as unknown,
        catch: () => new BadRequest({ message: "Invalid JSON" }),
      });
      frame = yield* Schema.decodeUnknownEffect(WorldClientFrame)(parsed).pipe(
        Effect.mapError(
          (error) => new BadRequest({ message: inputMessage(error, "Invalid frame") }),
        ),
      );
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) return;
      const world = yield* WorldLogic;
      yield* world.frame(
        socket,
        frame,
        attachment,
        () => this.presence(),
        (session, position) => this.broadcastCursor(session, position),
      );
    });
    return this.runtime.runPromise(
      operation.pipe(
        Effect.catchCause((cause) => {
          const error = Cause.findErrorOption(cause);
          const typed = Option.isSome(error) && !Cause.hasDies(cause);
          const message = typed
            ? error.value.message
            : frame?.type === "search"
              ? "Compendium search failed"
              : frame?.type.startsWith("roll")
                ? "Roll failed"
                : "World service unavailable";
          const requestId =
            frame?.type === "search"
              ? frame.requestId
              : typeof parsed === "object" &&
                  parsed !== null &&
                  "type" in parsed &&
                  parsed.type === "search" &&
                  "requestId" in parsed &&
                  typeof parsed.requestId === "string"
                ? parsed.requestId
                : undefined;
          const roll =
            frame?.type.startsWith("roll") ||
            (typeof parsed === "object" &&
              parsed !== null &&
              "type" in parsed &&
              parsed.type === "roll.table");
          return (typed ? Effect.void : Effect.logError(cause)).pipe(
            Effect.andThen(
              Effect.sync(() => {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    message,
                    ...(requestId === undefined ? {} : { code: "search", requestId }),
                    ...(roll ? { code: "roll" } : {}),
                  } satisfies ServerFrame),
                );
              }),
            ),
          );
        }),
      ),
    );
  }
  private sessions(): SocketAttachment[] {
    return this.ctx
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment() as SocketAttachment | null)
      .filter((value): value is SocketAttachment => value !== null);
  }
  private presence(): PresenceMember[] {
    const seen = new Map<string, PresenceMember>();
    for (const session of this.sessions())
      seen.set(session.memberId, {
        id: session.memberId,
        displayName: session.name,
        role: session.role,
        online: true,
      });
    return [...seen.values()];
  }
  private broadcast(frame: ServerFrame, filter?: BroadcastFilter) {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || (filter && !filter(attachment, socket))) continue;
      try {
        socket.send(payload);
      } catch {
        /* socket is closing */
      }
    }
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
  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    socket.serializeAttachment(null);
    if (attachment) this.broadcastCursor(attachment, null);
    socket.close(code, reason);
    this.broadcast({ type: "presence", members: this.presence() });
  }
  webSocketError(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    socket.serializeAttachment(null);
    if (attachment) this.broadcastCursor(attachment, null);
    this.broadcast({ type: "presence", members: this.presence() });
  }
}
