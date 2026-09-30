import * as Schema from "effect/Schema";

/** Text rights and attribution travel with every published source and override. */
export const Licence = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.optional(Schema.String),
  attribution: Schema.String,
  shareAlike: Schema.Boolean,
});
export type Licence = typeof Licence.Type;
