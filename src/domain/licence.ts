import * as Schema from "effect/Schema";
import { NonEmptyTrimmed } from "./constraints";

const Attribution = NonEmptyTrimmed(8_000);
const LicenceUrl = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
        );
      } catch {
        return false;
      }
    },
    { message: "Licence URL must use HTTP or HTTPS without credentials" },
  ),
);

/** Text rights and attribution travel with every published source and override. */
export const Licence = Schema.Struct({
  id: NonEmptyTrimmed(120),
  name: NonEmptyTrimmed(200),
  url: Schema.optional(LicenceUrl),
  attribution: Attribution,
  shareAlike: Schema.Boolean,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type Licence = typeof Licence.Type;

/** Text licences describe attribution, not permission to use art or imply endorsement. */
export const licenceError = (licence: Licence): string | undefined => {
  const result = Schema.decodeUnknownResult(Licence)(licence);
  return result._tag === "Failure" ? result.failure.message : undefined;
};

/** Combine validated licences; the combined attribution has a new length. */
export const mergeLicence = (base: Licence, proposed?: Licence): Licence => {
  const attribution =
    proposed === undefined || base.attribution.includes(proposed.attribution)
      ? base.attribution
      : proposed.attribution.includes(base.attribution)
        ? proposed.attribution
        : Schema.decodeUnknownSync(Attribution)(`${base.attribution}\n\n${proposed.attribution}`);
  return {
    ...base,
    attribution,
    shareAlike: base.shareAlike || proposed?.shareAlike === true,
  };
};

/** Keep the source's rights, adding a world author's attribution when supplied. */
export const inheritLicence = (base: Licence, proposed?: Licence): Licence => {
  const validated = Schema.decodeUnknownSync(Licence)(base);
  const additions =
    proposed === undefined ? undefined : Schema.decodeUnknownSync(Licence)(proposed);
  return mergeLicence(validated, additions);
};
