import type { SheetField, SheetTemplate } from "./schemas";
import type { LayoutBlock, SheetLayout } from "./sheet-layout";

export const layoutFromTemplate = (template: SheetTemplate): SheetLayout => {
  const blocks: LayoutBlock[] = [];
  if (template.tickers.length) {
    blocks.push({
      id: "legacy-trackers",
      type: "trackers",
      items: template.tickers.map((ticker) => ({
        key: ticker.id,
        label: ticker.label,
        min: ticker.min,
        max: ticker.max,
        start: ticker.defaultValue,
        display: ticker.display,
      })),
    });
  }
  if (template.stats.length) {
    blocks.push({
      id: "legacy-stats",
      type: "stats",
      items: template.stats.map((stat) => ({ key: stat.id, label: stat.label })),
    });
  }
  if (template.rolls.length) {
    blocks.push({
      id: "legacy-rolls",
      type: "rolls",
      items: template.rolls.map((roll) => ({
        label: roll.label,
        dice: roll.dice.map((dice) => `${dice.count}d${dice.sides}`).join("+"),
      })),
    });
  }

  const groups = new Map<string, SheetField[]>();
  for (const field of template.fields) {
    const group = field.group ?? "Fields";
    const fields = groups.get(group) ?? [];
    fields.push(field);
    groups.set(group, fields);
  }
  let groupIndex = 0;
  for (const [title, fields] of groups) {
    const prefix = `legacy-group-${groupIndex++}`;
    blocks.push({ id: `${prefix}-heading`, type: "heading", text: title });
    const shortFields = fields.filter((field) => field.kind !== "longtext");
    if (shortFields.length) {
      blocks.push({
        id: `${prefix}-fields`,
        type: "fields",
        columns: 2,
        items: shortFields.map((field) => ({ key: field.id, label: field.label })),
      });
    }
    fields
      .filter((field) => field.kind === "longtext")
      .forEach((field, index) => {
        blocks.push({
          id: `${prefix}-text-${index}`,
          type: "text",
          key: field.id,
          // A lone longtext field usually shares its group's name; the heading already says it.
          label: field.label === title ? undefined : field.label,
        });
      });
  }
  return {
    system: template.name,
    name: "Classic",
    pages: [{ id: "legacy-sheet", title: template.name, blocks }],
  };
};

export const effectiveLayout = (template: SheetTemplate): SheetLayout =>
  template.layout ?? layoutFromTemplate(template);
