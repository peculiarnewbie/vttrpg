import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { SaveTemplateInput } from "./schemas";
import { presets } from "./sheet-presets";
import { presetTemplates } from "./preset-templates";
import { layoutLimitsError } from "./template-io";

it("offers each preset as a valid new template with empty legacy arrays", () => {
  const inputs = presetTemplates();
  expect(inputs).toHaveLength(presets.length);
  inputs.forEach((input, index) => {
    expect(Schema.decodeUnknownResult(SaveTemplateInput)(input)._tag).toBe("Success");
    expect(layoutLimitsError(input.layout)).toBeUndefined();
    expect(input).toEqual({
      name: `${presets[index].system} — ${presets[index].name}`,
      layout: presets[index],
      fields: [],
      stats: [],
      tickers: [],
      rolls: [],
    });
    expect(input.id).toBeUndefined();
  });
});
