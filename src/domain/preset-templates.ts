import type { SaveTemplateInput } from "./schemas";
import { presets } from "./sheet-presets";

export const presetTemplates = (): SaveTemplateInput[] =>
  presets.map((layout) => ({
    name: `${layout.system} — ${layout.name}`,
    layout,
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
  }));
