import { DurableObject } from "cloudflare:workers";
import * as Schema from "effect/Schema";
import { computeStats, evaluateRoll, makeResolver } from "../domain/dice";
import {
  Character,
  ChatMessage,
  ClientFrame,
  Note,
  NoteSummary,
  RollResult,
  SheetTemplate,
  type MemberRole,
  type PresenceMember,
  type SaveCharacterInput,
  type SaveNoteInput,
  type SaveTemplateInput,
  type ServerFrame,
  type Visibility,
} from "../domain/schemas";
import { newId, nowIso } from "./crypto";

export type WorldDoEnv = {
  BUCKET: R2Bucket;
};

type SocketAttachment = {
  memberId: string;
  name: string;
  role: MemberRole;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  fields: string;
  stats: string;
  tickers: string;
  rolls: string;
  updated_at: string;
};

type CharacterRow = {
  id: string;
  member_id: string;
  name: string;
  template_id: string;
  data: string;
  tickers: string;
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
  created_at: string;
};

type NoteRow = {
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
  constructor(ctx: DurableObjectState, env: WorldDoEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  private get worldId() {
    return this.ctx.id.name?.replace(/^world:/, "") ?? "unknown";
  }

  private ensureSchema() {
    const sql = this.ctx.storage.sql;
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
    const existing = sql.exec("SELECT COUNT(*) AS n FROM templates").one() as { n: number };
    if (!existing || existing.n === 0) this.insertTemplate(defaultTemplate(this.worldId));
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
      fields: parse(row.fields, []),
      stats: parse(row.stats, []),
      tickers: parse(row.tickers, []),
      rolls: parse(row.rolls, []),
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
      values: parse(row.data, {}),
      tickers: parse(row.tickers, {}),
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
      createdAt: row.created_at,
    };
  }

  private toNoteSummary(row: NoteRow): NoteSummary {
    return {
      id: row.id,
      title: row.title,
      ownerMemberId: row.owner_member_id,
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

  private listMessages(limit = 100): ChatMessage[] {
    const rows = this.ctx.storage.sql
      .exec<MessageRow>("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?", limit)
      .toArray();
    return rows.map((row) => this.toMessage(row)).reverse();
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
      "INSERT OR REPLACE INTO templates (id, name, description, fields, stats, tickers, rolls, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      template.id,
      template.name,
      template.description ?? null,
      JSON.stringify(template.fields),
      JSON.stringify(template.stats),
      JSON.stringify(template.tickers),
      JSON.stringify(template.rolls),
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
      updatedAt: nowIso(),
    };
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE templates SET name = ?, description = ?, fields = ?, stats = ?, tickers = ?, rolls = ?, updated_at = ? WHERE id = ?",
        template.name,
        template.description ?? null,
        JSON.stringify(template.fields),
        JSON.stringify(template.stats),
        JSON.stringify(template.tickers),
        JSON.stringify(template.rolls),
        template.updatedAt,
        id,
      );
    } else {
      this.insertTemplate(template);
    }
    return template;
  }

  private saveCharacter(input: SaveCharacterInput): Character {
    const now = nowIso();
    const id = input.id ?? newId("chr");
    const existing = this.getCharacter(id);
    const template = this.getTemplate(input.templateId) ?? this.getTemplate();
    const tickers: Record<string, number> = existing ? { ...existing.tickers } : {};
    if (template) {
      for (const ticker of template.tickers) {
        if (tickers[ticker.id] === undefined) tickers[ticker.id] = ticker.defaultValue;
      }
    }
    const character: Character = {
      id,
      worldId: this.worldId,
      memberId: input.memberId ?? existing?.memberId ?? "",
      name: input.name,
      templateId: input.templateId,
      values: input.values,
      tickers,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE characters SET member_id = ?, name = ?, template_id = ?, data = ?, updated_at = ? WHERE id = ?",
        character.memberId,
        character.name,
        character.templateId,
        JSON.stringify(character.values),
        now,
        id,
      );
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO characters (id, member_id, name, template_id, data, tickers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        character.memberId,
        character.name,
        character.templateId,
        JSON.stringify(character.values),
        JSON.stringify(character.tickers),
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
    const definition = template?.tickers.find((ticker) => ticker.id === tickerId);
    const clamped = definition ? Math.max(definition.min, Math.min(definition.max, value)) : value;
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

  private createMessage(input: {
    authorMemberId: string;
    authorName: string;
    kind: ChatMessage["kind"];
    content: string;
    visibility: Visibility;
    recipientMemberIds: readonly string[];
    roll?: RollResult;
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
      createdAt: nowIso(),
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, author_member_id, author_name, kind, content, visibility, recipient_ids, roll, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      message.id,
      message.authorMemberId,
      message.authorName,
      message.kind,
      message.content,
      message.visibility,
      JSON.stringify(message.recipientMemberIds),
      message.roll ? JSON.stringify(message.roll) : null,
      message.createdAt,
    );
    return message;
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

  private async saveNote(
    input: SaveNoteInput & { id?: string; ownerMemberId: string },
  ): Promise<Note> {
    const id = input.id ?? newId("note");
    const prefix = `world/${this.worldId}`;
    const key = `${prefix}/notes/${id}.md`;
    await this.env.BUCKET.put(key, input.content, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    const updatedAt = nowIso();
    const existing = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
      .toArray()[0];
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE notes SET title = ?, visibility = ?, updated_at = ? WHERE id = ?",
        input.title,
        input.visibility,
        updatedAt,
        id,
      );
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO notes (id, title, owner_member_id, visibility, r2_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        input.title,
        input.ownerMemberId,
        input.visibility,
        key,
        updatedAt,
      );
    }
    return {
      id,
      title: input.title,
      ownerMemberId: input.ownerMemberId,
      visibility: input.visibility,
      content: input.content,
      updatedAt,
    };
  }

  private async deleteNote(id: string) {
    const row = this.ctx.storage.sql
      .exec<NoteRow>("SELECT * FROM notes WHERE id = ? LIMIT 1", id)
      .toArray()[0];
    if (row) await this.env.BUCKET.delete(row.r2_key);
    this.ctx.storage.sql.exec("DELETE FROM notes WHERE id = ?", id);
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

  private broadcast(frame: ServerFrame, filter?: (session: SocketAttachment) => boolean) {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      if (filter && !filter(attachment)) continue;
      try {
        socket.send(payload);
      } catch {
        // socket is closing; ignore
      }
    }
  }

  private broadcastMessage(message: ChatMessage) {
    this.broadcast({ type: "message", message }, (session) => this.visibleTo(message, session));
  }

  // -------------------------------------------------------------------------
  // Fetch: websockets + internal JSON API
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.handleUpgrade(request);
    }

    if (url.pathname.startsWith("/internal/")) {
      return this.handleInternal(request, url);
    }

    return json({ error: "Not found" }, 404);
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
    this.broadcast({ type: "presence", members: this.presence() });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleInternal(request: Request, url: URL): Promise<Response> {
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const memberId = request.headers.get("x-ttrpg-member-id") ?? "";
    const memberName = request.headers.get("x-ttrpg-member-name") ?? "Unknown";
    const path = url.pathname.replace(/^\/internal\//, "");

    try {
      switch (`${request.method} ${path}`) {
        case "GET state":
          return json({
            templates: this.listTemplates(),
            characters: this.listCharacters(),
            messages: this.listMessages(),
            notes: this.listNotes(),
          });

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
          const evaluated = this.rollFor(String(body.characterId), String(body.rollId));
          if (!evaluated) return json({ error: "Roll not found" }, 404);
          const visibility = (body.visibility as Visibility) ?? evaluated.definition.visibility;
          const message = this.createMessage({
            authorMemberId: memberId,
            authorName: memberName,
            kind: "roll",
            content: `${evaluated.character.name}: ${evaluated.definition.label}`,
            visibility,
            recipientMemberIds: (body.recipientMemberIds as string[]) ?? [],
            roll: evaluated.result,
          });
          this.broadcastMessage(message);
          return json(message);
        }

        case "POST character": {
          const character = this.saveCharacter({
            id: body.id as string | undefined,
            name: String(body.name ?? "Unnamed"),
            templateId: String(body.templateId ?? ""),
            memberId: (body.memberId as string | undefined) ?? memberId,
            values: (body.values as Record<string, string | number>) ?? {},
          });
          this.broadcast({ type: "character", character });
          return json(character);
        }

        case "POST ticker": {
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
          const template = this.saveTemplate({
            id: body.id as string | undefined,
            name: String(body.name ?? "Untitled"),
            description: body.description as string | undefined,
            fields: (body.fields as SaveTemplateInput["fields"]) ?? [],
            stats: (body.stats as SaveTemplateInput["stats"]) ?? [],
            tickers: (body.tickers as SaveTemplateInput["tickers"]) ?? [],
            rolls: (body.rolls as SaveTemplateInput["rolls"]) ?? [],
          });
          return json(template);
        }

        case "POST note": {
          const note = await this.saveNote({
            id: body.id as string | undefined,
            title: String(body.title ?? "Untitled"),
            visibility: (body.visibility as Visibility) ?? "private",
            content: String(body.content ?? ""),
            ownerMemberId: (body.ownerMemberId as string | undefined) ?? memberId,
          });
          return json(note);
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
        await this.deleteNote(noteMatch[1]);
        return json({ ok: true });
      }

      const characterMatch = /^character\/([^/]+)$/.exec(path);
      if (characterMatch && request.method === "DELETE") {
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
      socket.send(
        JSON.stringify({ type: "error", message: "Invalid frame" } satisfies ServerFrame),
      );
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const frame = decoded.success;

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
      const evaluated = this.rollFor(frame.characterId, frame.rollId);
      if (!evaluated) return;
      const message = this.createMessage({
        authorMemberId: attachment.memberId,
        authorName: attachment.name,
        kind: "roll",
        content: `${evaluated.character.name}: ${evaluated.definition.label}`,
        visibility: frame.visibility,
        recipientMemberIds: frame.recipientMemberIds,
        roll: evaluated.result,
      });
      this.broadcastMessage(message);
      return;
    }

    if (frame.type === "character.save") {
      const character = this.saveCharacter({
        id: frame.character.id,
        name: frame.character.name,
        templateId: frame.character.templateId,
        memberId: frame.character.memberId || attachment.memberId,
        values: frame.character.values,
      });
      this.broadcast({ type: "character", character });
      return;
    }

    if (frame.type === "ticker.set") {
      const character = this.setTicker(frame.characterId, frame.tickerId, frame.value);
      if (character) this.broadcast({ type: "character", character });
      return;
    }

    if (frame.type === "note.saved") {
      socket.send(
        JSON.stringify({ type: "presence", members: this.presence() } satisfies ServerFrame),
      );
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
    this.broadcast({ type: "presence", members: this.presence() });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.serializeAttachment(null);
    this.broadcast({ type: "presence", members: this.presence() });
  }
}
