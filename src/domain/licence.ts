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

/** Text licences describe attribution, not permission to use art or imply endorsement. */
export const licenceError = (licence: Licence): string | undefined => {
  const result = Schema.decodeUnknownResult(Licence, { onExcessProperty: "error" })(licence);
  if (result._tag === "Failure") return "Invalid text licence";
  if (!licence.id.trim() || licence.id.length > 120) return "Licence id must be 1–120 characters";
  if (!licence.name.trim() || licence.name.length > 200)
    return "Licence name must be 1–200 characters";
  if (!licence.attribution.trim() || licence.attribution.length > 8_000)
    return "Licence attribution must be 1–8000 characters";
  if (licence.url !== undefined) {
    if (licence.url.length > 2_048) return "Licence URL is too long";
    try {
      const url = new URL(licence.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        return "Licence URL must use HTTP or HTTPS";
    } catch {
      return "Invalid licence URL";
    }
  }
  return undefined;
};

/** Keep the source's rights, adding a world author's attribution when supplied. */
export const inheritLicence = (base: Licence, proposed?: Licence): Licence => {
  const error = licenceError(base) ?? (proposed === undefined ? undefined : licenceError(proposed));
  if (error) throw new Error(error);
  const attribution =
    proposed === undefined || base.attribution.includes(proposed.attribution)
      ? base.attribution
      : proposed.attribution.includes(base.attribution)
        ? proposed.attribution
        : `${base.attribution}\n\n${proposed.attribution}`;
  const inherited = {
    ...base,
    attribution,
    shareAlike: base.shareAlike || proposed?.shareAlike === true,
  };
  const inheritedError = licenceError(inherited);
  if (inheritedError) throw new Error(inheritedError);
  return inherited;
};
