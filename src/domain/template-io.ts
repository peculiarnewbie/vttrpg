import * as Schema from "effect/Schema";
import { SaveTemplateInput, type SheetTemplate } from "./schemas";
import { layoutTrackers, type SheetLayout } from "./sheet-layout";
import { DERIVED_LIMITS, parseExpr } from "./derived";

/** Shared limits for saved and imported layouts. Group containers count as blocks. */
export const layoutLimitsError = (layout: SheetLayout | undefined): string | undefined => {
  if (!layout) return undefined;
  if (new TextEncoder().encode(JSON.stringify(layout)).byteLength > 64 * 1024)
    return "Layout JSON must be at most 64 KB";
  if (layout.pages.length > 10) return "Layout must have at most 10 pages";
  const blocks = layout.pages.flatMap((page) =>
    page.blocks.flatMap((block) => (block.type === "group" ? [block, ...block.blocks] : [block])),
  );
  if (blocks.length > 200) return "Layout must have at most 200 blocks";
  const ids = new Set<string>();
  for (const block of blocks) {
    if (ids.has(block.id)) return "Layout block ids must be unique";
    ids.add(block.id);
  }
  const keys = new Set<string>();
  for (const tracker of layoutTrackers(layout)) {
    if (keys.has(tracker.key)) return "Layout tracker keys must be unique";
    keys.add(tracker.key);
  }
  const derived = layout.derived ?? [];
  if (derived.length > DERIVED_LIMITS.count)
    return `Layout must have at most ${DERIVED_LIMITS.count} derived values`;
  const derivedKeys = new Set<string>();
  for (const item of derived) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key))
      return `Derived "${item.label}" needs a key with letters, digits or underscores, starting with a letter or underscore`;
    if (derivedKeys.has(item.key)) return "Layout derived keys must be unique";
    derivedKeys.add(item.key);
    if (!item.label.trim() || item.label.length > 60)
      return "Derived labels must be non-empty and at most 60 characters";
    const parsed = parseExpr(item.expr);
    if (!parsed.ok) return `Derived "${item.label}": ${parsed.error}`;
  }
  for (const block of blocks) {
    if (block.type !== "list") continue;
    for (const column of block.columns) {
      if (column.kind !== "derived") continue;
      const parsed = parseExpr(column.expr ?? "");
      if (!parsed.ok) return `Derived column "${column.label}": ${parsed.error}`;
    }
  }
  return undefined;
};

const { id: _id, ...portableFields } = SaveTemplateInput.fields;
const PortableTemplate = Schema.Struct(portableFields);
const Envelope = Schema.Struct({
  format: Schema.Literal("ttrpg-template"),
  version: Schema.Literal(1),
  template: PortableTemplate,
});

export const exportTemplate = (template: SheetTemplate): string => {
  const input: Omit<SaveTemplateInput, "id"> = {
    name: template.name,
    description: template.description,
    fields: template.fields,
    stats: template.stats,
    tickers: template.tickers,
    rolls: template.rolls,
    layout: template.layout,
  };
  return JSON.stringify({ format: "ttrpg-template", version: 1, template: input }, null, 2);
};

export const importTemplate = (
  text: string,
): { ok: true; input: SaveTemplateInput } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const header = Schema.decodeUnknownResult(
    Schema.Struct({ format: Schema.String, version: Schema.Number }),
  )(parsed);
  if (header._tag === "Failure" || header.success.format !== "ttrpg-template")
    return { ok: false, error: "Expected ttrpg-template format" };
  if (header.success.version !== 1) return { ok: false, error: "Unsupported template version" };
  const decoded = Schema.decodeUnknownResult(Envelope)(parsed);
  if (decoded._tag === "Failure") return { ok: false, error: "Invalid template data" };
  const input = decoded.success.template;
  const error = layoutLimitsError(input.layout);
  return error ? { ok: false, error } : { ok: true, input };
};
