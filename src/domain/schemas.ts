import * as Schema from "effect/Schema";
import { SheetLayout } from "./sheet-layout";
import { BoardSnapshot, BoardFocusRect, BoardAssetId, SceneList } from "./board";

export type Infer<S> = Schema.Schema.Type<S>;

export const Id = Schema.String;

/** Who can see a message or roll. */
export const Visibility = Schema.Literals(["public", "private", "dm"]);
export type Visibility = Infer<typeof Visibility>;

export const MemberRole = Schema.Literals(["dm", "player"]);
export type MemberRole = Infer<typeof MemberRole>;

export const UserKind = Schema.Literals(["google", "local"]);
export type UserKind = Infer<typeof UserKind>;

// ---------------------------------------------------------------------------
// Dice / rolls
// ---------------------------------------------------------------------------

export const DiceGroup = Schema.Struct({
  count: Schema.Int,
  sides: Schema.Int,
});
export type DiceGroup = Infer<typeof DiceGroup>;

/**
 * A modifier that stacks onto a roll total.
 * - `static`  — a flat number
 * - `stat`    — a reference to a stat block, optionally multiplied
 * - `field`   — a reference to an editable number field on the sheet
 */
export const Modifier = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["static"]), value: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literals(["stat"]),
    statId: Schema.String,
    multiplier: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.Literals(["field"]),
    fieldId: Schema.String,
    multiplier: Schema.optional(Schema.Int),
  }),
]);
export type Modifier = Infer<typeof Modifier>;

export const RollDefinition = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  dice: Schema.Array(DiceGroup),
  modifiers: Schema.Array(Modifier),
  visibility: Visibility,
  description: Schema.optional(Schema.String),
});
export type RollDefinition = Infer<typeof RollDefinition>;

export const RolledDie = Schema.Struct({
  sides: Schema.Int,
  results: Schema.Array(Schema.Int),
  /** Per result: whether it counts (kh/kl/adv/dis drop the rest). Absent = all kept. */
  kept: Schema.optional(Schema.Array(Schema.Boolean)),
  /** The term was subtracted (`1d20 - 1d4`). */
  negative: Schema.optional(Schema.Boolean),
});
export type RolledDie = Infer<typeof RolledDie>;

export const RollModifierPart = Schema.Struct({
  label: Schema.String,
  value: Schema.Int,
});
export type RollModifierPart = Infer<typeof RollModifierPart>;

/** One `|`-separated part of a notation, rolled on its own and never added to the others. */
export const RollGroup = Schema.Struct({
  notation: Schema.String,
  dice: Schema.Array(RolledDie),
  modifiers: Schema.Array(RollModifierPart),
  total: Schema.Int,
});
export type RollGroup = Infer<typeof RollGroup>;

export const RollResult = Schema.Struct({
  notation: Schema.String,
  dice: Schema.Array(RolledDie),
  modifiers: Schema.Array(RollModifierPart),
  total: Schema.Int,
  /** Present when the notation has several groups; the fields above repeat the first. */
  groups: Schema.optional(Schema.Array(RollGroup)),
});
export type RollResult = Infer<typeof RollResult>;

// ---------------------------------------------------------------------------
// Character sheet templates
// ---------------------------------------------------------------------------

export const SheetFieldKind = Schema.Literals(["text", "number", "longtext"]);
export type SheetFieldKind = Infer<typeof SheetFieldKind>;

export const SheetField = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: SheetFieldKind,
  defaultValue: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  group: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
});
export type SheetField = Infer<typeof SheetField>;

/**
 * A named stat. Its value is `base + sum(modifiers)` and it can be referenced
 * by rolls and tickers.
 */
export const StatDefinition = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  base: Schema.optional(Schema.Int),
  modifiers: Schema.Array(Modifier),
});
export type StatDefinition = Infer<typeof StatDefinition>;

export const TickerDefinition = Schema.Struct({
  display: Schema.optional(Schema.Literals(["auto", "pips", "bar", "number"])),
  id: Schema.String,
  label: Schema.String,
  min: Schema.Int,
  max: Schema.Int,
  defaultValue: Schema.Int,
  color: Schema.optional(Schema.String),
});
export type TickerDefinition = Infer<typeof TickerDefinition>;

export const SheetTemplate = Schema.Struct({
  id: Schema.String,
  worldId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  fields: Schema.Array(SheetField),
  stats: Schema.Array(StatDefinition),
  tickers: Schema.Array(TickerDefinition),
  rolls: Schema.Array(RollDefinition),
  /**
   * Data-defined sheet (see sheet-layout.ts). When present it is what the sheet
   * renders; the legacy arrays above remain for older templates, which get an
   * equivalent layout derived from them.
   */
  layout: Schema.optional(SheetLayout),
  updatedAt: Schema.String,
});
export type SheetTemplate = Infer<typeof SheetTemplate>;

/** One row of a list block (Property, Harm, Skills…), keyed by column key. */
export const ListRowValue = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]),
);
export type ListRowValue = Infer<typeof ListRowValue>;

/**
 * A character value addressed by a field, stat, or block key: text and numbers
 * (fields, stats), booleans, string arrays (checkbox rows), and list rows.
 * Tracker values live separately in `Character.tickers`.
 */
export const CharacterValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Array(ListRowValue),
]);
export type CharacterValue = Infer<typeof CharacterValue>;

export const Character = Schema.Struct({
  id: Schema.String,
  worldId: Schema.String,
  memberId: Schema.String,
  name: Schema.String,
  templateId: Schema.String,
  values: Schema.Record(Schema.String, CharacterValue),
  tickers: Schema.Record(Schema.String, Schema.Int),
  tickerMax: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
  /** The owner's chosen variant per layout block id (e.g. stats as bars). */
  layoutPrefs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  avatarKey: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Character = Infer<typeof Character>;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const MessageKind = Schema.Literals(["ic", "ooc", "system", "roll"]);
export type MessageKind = Infer<typeof MessageKind>;

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  worldId: Schema.String,
  authorMemberId: Schema.String,
  authorName: Schema.String,
  kind: MessageKind,
  content: Schema.String,
  visibility: Visibility,
  recipientMemberIds: Schema.Array(Schema.String),
  roll: Schema.optional(RollResult),
  authorAvatarKey: Schema.optional(Schema.String),
  characterId: Schema.optional(Schema.String),
  createdAt: Schema.String,
});
export type ChatMessage = Infer<typeof ChatMessage>;

export const MessagePage = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  hasMore: Schema.Boolean,
});
export type MessagePage = Infer<typeof MessagePage>;

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const NoteSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  ownerMemberId: Schema.String,
  visibility: Visibility,
  editableByAll: Schema.optionalKey(Schema.Boolean),
  updatedAt: Schema.String,
});
export type NoteSummary = Infer<typeof NoteSummary>;

export const Note = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  ownerMemberId: Schema.String,
  visibility: Visibility,
  editableByAll: Schema.optionalKey(Schema.Boolean),
  content: Schema.String,
  updatedAt: Schema.String,
});
export type Note = Infer<typeof Note>;

// ---------------------------------------------------------------------------
// Accounts, worlds, members
// ---------------------------------------------------------------------------

export const AuthUser = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  email: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  kind: UserKind,
});
export type AuthUser = Infer<typeof AuthUser>;

export const WorldSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: MemberRole,
  memberName: Schema.String,
  ownerName: Schema.String,
  createdAt: Schema.String,
});
export type WorldSummary = Infer<typeof WorldSummary>;

export const MemberKind = Schema.Literals(["owner", "invite", "password"]);
export type MemberKind = Infer<typeof MemberKind>;

export const WorldMember = Schema.Struct({
  id: Schema.String,
  worldId: Schema.String,
  displayName: Schema.String,
  role: MemberRole,
  kind: MemberKind,
  email: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  characterId: Schema.optional(Schema.String),
  createdAt: Schema.String,
});
export type WorldMember = Infer<typeof WorldMember>;

export const PresenceMember = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  role: MemberRole,
  online: Schema.Boolean,
});
export type PresenceMember = Infer<typeof PresenceMember>;

export const CursorPosition = Schema.Struct({
  x: Schema.Finite.check(Schema.isBetween({ minimum: -100000, maximum: 100000 })),
  y: Schema.Finite.check(Schema.isBetween({ minimum: -100000, maximum: 100000 })),
});
export type CursorPosition = Infer<typeof CursorPosition>;
export const LiveCursor = Schema.Struct({
  id: Schema.String,
  memberId: Schema.String,
  displayName: Schema.String,
  position: Schema.NullOr(CursorPosition),
});
export type LiveCursor = Infer<typeof LiveCursor>;

// ---------------------------------------------------------------------------
// Realtime frames
// ---------------------------------------------------------------------------

export const BoardFocus = Schema.Struct({
  type: Schema.Literal("board.focus"),
  rect: BoardFocusRect,
  sceneId: Schema.optionalKey(BoardAssetId),
  from: Schema.String,
});
export type BoardFocus = Infer<typeof BoardFocus>;

export const ClientFrame = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("board.focus"),
    sceneId: Schema.optionalKey(BoardAssetId),
    rect: BoardFocusRect,
  }),
  Schema.Struct({ type: Schema.Literal("cursors.subscribe"), enabled: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("cursor"), position: Schema.NullOr(CursorPosition) }),
  Schema.Struct({ type: Schema.Literals(["ping"]) }),
  Schema.Struct({
    type: Schema.Literals(["chat"]),
    content: Schema.String,
    kind: Schema.Literals(["ic", "ooc"]),
    visibility: Visibility,
    recipientMemberIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literals(["roll"]),
    characterId: Schema.String,
    rollId: Schema.String,
    visibility: Visibility,
    recipientMemberIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literals(["roll.dice"]),
    notation: Schema.String,
    visibility: Visibility,
    recipientMemberIds: Schema.optional(Schema.Array(Schema.String)),
    /** What was rolled, e.g. a Property row's item ("Longsword"); shown with the dice. */
    label: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
    /**
     * The sheet `@refs` resolve against, on the server. Required when the
     * notation has refs; owner or DM only. Values are read, never written.
     */
    characterId: Schema.optional(Schema.String),
    /** The list row `@row.column` refers to. */
    row: Schema.optional(Schema.Struct({ key: Schema.String, index: Schema.Int })),
  }),
  Schema.Struct({
    type: Schema.Literals(["character.save"]),
    character: Character,
  }),
  Schema.Struct({
    type: Schema.Literals(["ticker.set"]),
    characterId: Schema.String,
    tickerId: Schema.String,
    value: Schema.Int,
    requestId: Schema.optional(Schema.String),
  }),
  /** Set one value (a list, a checkbox row, a field) without a full sheet save. Owner or DM. */
  Schema.Struct({
    type: Schema.Literal("character.value"),
    characterId: Schema.String,
    key: Schema.String,
    value: CharacterValue,
    requestId: Schema.optional(Schema.String),
  }),
  /** Choose a block's variant for this character; `null` restores the layout's. Owner or DM. */
  Schema.Struct({
    type: Schema.Literal("character.prefs"),
    characterId: Schema.String,
    blockId: Schema.String,
    variant: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literals(["note.saved"]), noteId: Schema.String }),
]);
export type ClientFrame = Infer<typeof ClientFrame>;

export const ServerFrame = Schema.Union([
  BoardFocus,
  Schema.Struct({ type: Schema.Literal("notes.updated") }),
  /** The compendium changed; clients refetch GET /compendium (it is filtered per member). */
  Schema.Struct({ type: Schema.Literal("compendium.updated") }),
  Schema.Struct({ type: Schema.Literal("cursor"), cursor: LiveCursor }),
  Schema.Struct({
    type: Schema.Literal("board"),
    board: BoardSnapshot,
    sceneId: BoardAssetId,
    sceneName: Schema.String,
    activeSceneId: BoardAssetId,
  }),
  Schema.Struct({ type: Schema.Literal("scenes"), ...SceneList.fields }),
  Schema.Struct({
    type: Schema.Literals(["hello"]),
    worldId: Schema.String,
    member: WorldMember,
    members: Schema.Array(PresenceMember),
  }),
  Schema.Struct({ type: Schema.Literals(["message"]), message: ChatMessage }),
  Schema.Struct({
    type: Schema.Literals(["character"]),
    character: Character,
    requestId: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literals(["presence"]), members: Schema.Array(PresenceMember) }),
  Schema.Struct({ type: Schema.Literals(["error"]), message: Schema.String }),
]);
export type ServerFrame = Infer<typeof ServerFrame>;

// ---------------------------------------------------------------------------
// HTTP payloads
// ---------------------------------------------------------------------------

export const CreateWorldInput = Schema.Struct({
  name: Schema.String,
});
export type CreateWorldInput = Infer<typeof CreateWorldInput>;

export const DevGoogleInput = Schema.Struct({
  email: Schema.String,
  displayName: Schema.optional(Schema.String),
});
export type DevGoogleInput = Infer<typeof DevGoogleInput>;

export const LoginInput = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
});
export type LoginInput = Infer<typeof LoginInput>;

export const CreateMemberInput = Schema.Struct({
  displayName: Schema.String,
  role: MemberRole,
  kind: MemberKind,
  email: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
});
export type CreateMemberInput = Infer<typeof CreateMemberInput>;

export const UpdateMemberInput = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  role: Schema.optional(MemberRole),
  password: Schema.optional(Schema.String),
  characterId: Schema.optional(Schema.String),
});
export type UpdateMemberInput = Infer<typeof UpdateMemberInput>;

export const SaveTemplateInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  fields: Schema.Array(SheetField),
  stats: Schema.Array(StatDefinition),
  tickers: Schema.Array(TickerDefinition),
  rolls: Schema.Array(RollDefinition),
  layout: Schema.optional(SheetLayout),
});
export type SaveTemplateInput = Infer<typeof SaveTemplateInput>;

export const SaveCharacterInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  templateId: Schema.String,
  memberId: Schema.optional(Schema.String),
  values: Schema.Record(Schema.String, CharacterValue),
  tickerMax: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
});
export type SaveCharacterInput = Infer<typeof SaveCharacterInput>;

export const SaveNoteInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  visibility: Visibility,
  editableByAll: Schema.optionalKey(Schema.Boolean),
  content: Schema.String,
});
export type SaveNoteInput = Infer<typeof SaveNoteInput>;

export const ErrorResponse = Schema.Struct({
  error: Schema.String,
});
export type ErrorResponse = Infer<typeof ErrorResponse>;
