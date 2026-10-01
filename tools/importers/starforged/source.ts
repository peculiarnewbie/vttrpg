import * as Schema from "effect/Schema";

const Source = Schema.Struct({ license: Schema.String });
const sourced = { _source: Schema.optional(Source) };
const named = { ...sourced, _id: Schema.String, name: Schema.String };
const prose = {
  summary: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
};

const Row = Schema.Struct({
  ...sourced,
  min: Schema.NullOr(Schema.Int),
  max: Schema.NullOr(Schema.Int),
  text: Schema.String,
  text2: Schema.optional(Schema.NullOr(Schema.String)),
  text3: Schema.optional(Schema.NullOr(Schema.String)),
});
const Table = Schema.Struct({ ...sourced, dice: Schema.String, rows: Schema.Array(Row) });
export const Oracle = Schema.Struct({
  ...named,
  ...prose,
  dice: Schema.String,
  rows: Schema.Array(Row),
  recommended_rolls: Schema.optional(Schema.Struct({ min: Schema.Int, max: Schema.Int })),
  match: Schema.optional(Schema.Struct({ text: Schema.String })),
});
export type Oracle = typeof Oracle.Type;

const RollOption = Schema.Union([
  Schema.Struct({ using: Schema.Literal("stat"), stat: Schema.String }),
  Schema.Struct({ using: Schema.Literal("condition_meter"), condition_meter: Schema.String }),
  Schema.Struct({ using: Schema.Literal("asset_control"), control: Schema.String }),
  Schema.Struct({ using: Schema.Literal("custom"), value: Schema.Number, label: Schema.String }),
  Schema.Struct({ using: Schema.Literal("progress_track") }),
  Schema.Struct({
    using: Schema.Literals(["bonds_legacy", "quests_legacy", "discoveries_legacy"]),
  }),
]);
export const Move = Schema.Struct({
  ...named,
  roll_type: Schema.Literals(["no_roll", "action_roll", "progress_roll", "special_track"]),
  trigger: Schema.Struct({
    text: Schema.String,
    conditions: Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          method: Schema.NullOr(Schema.String),
          roll_options: Schema.NullOr(Schema.Array(RollOption)),
        }),
      ),
    ),
  }),
  text: Schema.String,
  oracles: Schema.optional(Schema.Array(Schema.String)),
});
export type Move = typeof Move.Type;

type Control = {
  readonly _source?: typeof Source.Type;
  readonly label: string;
  readonly field_type: string;
  readonly min?: number;
  readonly max?: number | null;
  readonly value?: string | number | boolean | null;
  readonly controls?: Readonly<Record<string, Control>>;
  readonly choices?: Readonly<Record<string, { readonly label: string; readonly value?: number }>>;
};
const Control: Schema.Codec<Control> = Schema.suspend(() =>
  Schema.Struct({
    ...sourced,
    label: Schema.String,
    field_type: Schema.String,
    min: Schema.optional(Schema.Number),
    max: Schema.optional(Schema.NullOr(Schema.Number)),
    value: Schema.optional(
      Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
    ),
    controls: Schema.optional(Schema.Record(Schema.String, Control)),
    choices: Schema.optional(
      Schema.Record(
        Schema.String,
        Schema.Struct({ label: Schema.String, value: Schema.optional(Schema.Number) }),
      ),
    ),
  }),
);
export const Asset = Schema.Struct({
  ...named,
  category: Schema.String,
  requirement: Schema.optional(Schema.String),
  abilities: Schema.Array(
    Schema.Struct({
      ...sourced,
      enabled: Schema.Boolean,
      text: Schema.String,
      moves: Schema.optional(Schema.Record(Schema.String, Schema.Struct(named))),
    }),
  ),
  controls: Schema.optional(Schema.Record(Schema.String, Control)),
  options: Schema.optional(Schema.Record(Schema.String, Control)),
});
export type Asset = typeof Asset.Type;

const Variant = Schema.Struct({
  ...named,
  rank: Schema.Number,
  nature: Schema.String,
  description: Schema.String,
});
export const Npc = Schema.Struct({
  ...named,
  ...prose,
  rank: Schema.Number,
  nature: Schema.String,
  features: Schema.Array(Schema.String),
  drives: Schema.Array(Schema.String),
  tactics: Schema.Array(Schema.String),
  quest_starter: Schema.optional(Schema.String),
  variants: Schema.optional(Schema.Record(Schema.String, Variant)),
});
export type Npc = typeof Npc.Type;

export const Truth = Schema.Struct({
  ...named,
  options: Schema.Array(
    Schema.Struct({
      ...sourced,
      min: Schema.Int,
      max: Schema.Int,
      summary: Schema.String,
      description: Schema.String,
      quest_starter: Schema.optional(Schema.String),
      table: Schema.optional(Table),
    }),
  ),
  your_character: Schema.optional(Schema.String),
});
export type Truth = typeof Truth.Type;

export type Collection<T> = {
  readonly _id: string;
  readonly name: string;
  readonly _source?: typeof Source.Type;
  readonly summary?: string;
  readonly description?: string;
  readonly contents?: Readonly<Record<string, T>>;
  readonly collections?: Readonly<Record<string, Collection<T>>>;
};
const collection = <T>(item: Schema.Codec<T>): Schema.Codec<Collection<T>> => {
  const self: Schema.Codec<Collection<T>> = Schema.suspend(() =>
    Schema.Struct({
      ...named,
      ...prose,
      contents: Schema.optional(Schema.Record(Schema.String, item)),
      collections: Schema.optional(Schema.Record(Schema.String, self)),
    }),
  );
  return self;
};
export const Datasworn = Schema.Struct({
  license: Schema.String,
  moves: Schema.Record(Schema.String, collection(Move)),
  assets: Schema.Record(Schema.String, collection(Asset)),
  oracles: Schema.Record(Schema.String, collection(Oracle)),
  npcs: Schema.Record(Schema.String, collection(Npc)),
  truths: Schema.Record(Schema.String, Truth),
});
