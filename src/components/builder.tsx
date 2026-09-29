import { For, Show, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { api, ApiError } from "../client/api";
import type {
  DiceGroup,
  Modifier,
  RollDefinition,
  SaveTemplateInput,
  SheetField,
  SheetFieldKind,
  SheetTemplate,
  StatDefinition,
  TickerDefinition,
  Visibility,
} from "../domain/schemas";
import { Button, ErrorBanner, Field, Input } from "./ui";
import { LayoutEditor } from "./layout-editor";
import { layoutFromTemplate } from "../domain/layout-from-template";
import { presetTemplates } from "../domain/preset-templates";
import { exportTemplate, importTemplate } from "../domain/template-io";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

const builderStyles = stylex.create({
  trackersGrid: {
    gridTemplateColumns: "minmax(0, 2fr) repeat(3, minmax(0, 0.7fr)) minmax(76px, 1fr) 36px",
  },
});

const slug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "field";

/** An id derived from the label that doesn't collide with the other items in the list. */
export const idFromLabel = (label: string, taken: readonly { id: string }[], self: number) => {
  const base = slug(label);
  const used = new Set(taken.filter((_, index) => index !== self).map((item) => item.id));
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
};

/** Label input with its stable id shown underneath; ids follow the label until first saved. */
function LabelCell(props: { label: string; id: string; onLabel: (label: string) => void }) {
  return (
    <div {...sx(styles.builderLabelCell)}>
      <Input value={props.label} onInput={props.onLabel} />
      <span {...sx(styles.builderId)} title="Used by rolls and stats to refer to this">
        id: {props.id}
      </span>
    </div>
  );
}

function Headings(props: { style: "fields" | "stats" | "trackers" | "rolls"; labels: string[] }) {
  return (
    <div
      {...sx(
        styles.builderHeadings,
        props.style === "fields" && styles.builderFieldsGrid,
        props.style === "stats" && styles.builderStatsGrid,
        props.style === "trackers" && builderStyles.trackersGrid,
        props.style === "rolls" && styles.builderRollsGrid,
      )}
      aria-hidden="true"
    >
      <For each={props.labels}>{(label) => <span>{label}</span>}</For>
    </div>
  );
}

const toDraft = (template: SheetTemplate): SaveTemplateInput => ({
  id: template.id,
  name: template.name,
  description: template.description,
  fields: [...template.fields],
  stats: [...template.stats],
  tickers: [...template.tickers],
  rolls: [...template.rolls],
  layout: template.layout,
});

const emptyTemplate = (): SaveTemplateInput => ({
  name: "New template",
  description: "",
  fields: [{ id: "name", label: "Name", kind: "text", group: "Identity" }],
  stats: [],
  tickers: [],
  rolls: [],
});

function ModifierEditor(props: {
  modifiers: readonly Modifier[];
  stats: readonly StatDefinition[];
  fields: readonly SheetField[];
  onChange: (modifiers: Modifier[]) => void;
}) {
  const update = (index: number, next: Modifier) => {
    const copy = [...props.modifiers];
    copy[index] = next;
    props.onChange(copy);
  };

  return (
    <div {...sx(styles.col)}>
      <For each={props.modifiers}>
        {(modifier, index) => (
          <div {...sx(styles.modifier)}>
            <select
              {...sx(styles.select)}
              value={modifier.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as Modifier["kind"];
                if (kind === "static") update(index(), { kind: "static", value: 0 });
                else if (kind === "stat")
                  update(index(), {
                    kind: "stat",
                    statId: props.stats[0]?.id ?? "",
                    multiplier: 1,
                  });
                else
                  update(index(), {
                    kind: "field",
                    fieldId: props.fields[0]?.id ?? "",
                    multiplier: 1,
                  });
              }}
            >
              <option value="static">static</option>
              <option value="stat">stat</option>
              <option value="field">field</option>
            </select>
            <Show when={modifier.kind === "static"}>
              <Input
                type="number"
                value={(modifier as { value: number }).value}
                onInput={(value) => update(index(), { kind: "static", value: Number(value) })}
              />
            </Show>
            <Show when={modifier.kind === "stat"}>
              <select
                {...sx(styles.select)}
                value={(modifier as { statId: string }).statId}
                onChange={(event) =>
                  update(index(), {
                    kind: "stat",
                    statId: event.currentTarget.value,
                    multiplier: (modifier as { multiplier?: number }).multiplier ?? 1,
                  })
                }
              >
                <For each={props.stats}>
                  {(stat) => <option value={stat.id}>{stat.label}</option>}
                </For>
              </select>
            </Show>
            <Show when={modifier.kind === "field"}>
              <select
                {...sx(styles.select)}
                value={(modifier as { fieldId: string }).fieldId}
                onChange={(event) =>
                  update(index(), {
                    kind: "field",
                    fieldId: event.currentTarget.value,
                    multiplier: (modifier as { multiplier?: number }).multiplier ?? 1,
                  })
                }
              >
                <For each={props.fields}>
                  {(field) => <option value={field.id}>{field.label}</option>}
                </For>
              </select>
            </Show>
            <Show when={modifier.kind !== "static"}>
              <Input
                type="number"
                value={(modifier as { multiplier?: number }).multiplier ?? 1}
                onInput={(value) =>
                  modifier.kind === "stat"
                    ? update(index(), {
                        kind: "stat",
                        statId: modifier.statId,
                        multiplier: Number(value),
                      })
                    : modifier.kind === "field"
                      ? update(index(), {
                          kind: "field",
                          fieldId: modifier.fieldId,
                          multiplier: Number(value),
                        })
                      : undefined
                }
              />
            </Show>
            <Show when={modifier.kind === "static"}>
              <span />
            </Show>
            <Button
              small
              variant="danger"
              onClick={() => props.onChange(props.modifiers.filter((_, i) => i !== index()))}
            >
              ×
            </Button>
          </div>
        )}
      </For>
      <Button
        small
        onClick={() => props.onChange([...props.modifiers, { kind: "static", value: 0 }])}
      >
        Add modifier
      </Button>
    </div>
  );
}

function DiceEditor(props: { dice: readonly DiceGroup[]; onChange: (dice: DiceGroup[]) => void }) {
  const update = (index: number, next: DiceGroup) => {
    const copy = [...props.dice];
    copy[index] = next;
    props.onChange(copy);
  };
  return (
    <div {...sx(styles.col)}>
      <For each={props.dice}>
        {(die, index) => (
          <div {...sx(styles.diceGroup)}>
            <Input
              type="number"
              value={die.count}
              onInput={(value) => update(index(), { ...die, count: Number(value) })}
            />
            <Input
              type="number"
              value={die.sides}
              onInput={(value) => update(index(), { ...die, sides: Number(value) })}
            />
            <Button
              small
              variant="danger"
              onClick={() => props.onChange(props.dice.filter((_, i) => i !== index()))}
            >
              ×
            </Button>
          </div>
        )}
      </For>
      <Button small onClick={() => props.onChange([...props.dice, { count: 1, sides: 20 }])}>
        Add dice
      </Button>
    </div>
  );
}

export function BuilderPanel(props: {
  worldId: string;
  templates: SheetTemplate[];
  onTemplates: (templates: SheetTemplate[]) => void;
}) {
  const [draft, setDraft] = createSignal<SaveTemplateInput>(
    props.templates[0] ? toDraft(props.templates[0]) : emptyTemplate(),
  );
  const [error, setError] = createSignal("");
  const [saved, setSaved] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const patch = (partial: Partial<SaveTemplateInput>) =>
    setDraft((prev) => ({ ...prev, ...partial }));
  // Saved ids are referenced by characters, rolls and stats, so only unsaved items rename.
  const savedTemplate = () => props.templates.find((template) => template.id === draft().id);
  const isFresh = (list: "fields" | "stats" | "tickers" | "rolls", id: string) =>
    !savedTemplate()?.[list].some((item) => item.id === id);

  const loadTemplate = (template: SheetTemplate) => setDraft(toDraft(template));
  const presets = presetTemplates();
  const asTemplate = (): SheetTemplate => ({
    ...draft(),
    id: draft().id ?? "",
    worldId: props.worldId,
    updatedAt: "",
  });
  const exportDraft = () => {
    const url = URL.createObjectURL(
      new Blob([exportTemplate(asTemplate())], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(draft().name) || "template"}.ttrpg-template.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  // Imports load as an unsaved draft so the DM can review before saving.
  const importFile = async (file: File) => {
    setError("");
    setSaved("");
    const result = importTemplate(await file.text());
    if (!result.ok) return setError(`Could not import: ${result.error}`);
    setDraft({ ...result.input, id: undefined });
    setSaved(`Imported “${result.input.name}”. Review it, then save.`);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const template = await api.saveTemplate(props.worldId, draft());
      const others = props.templates.filter((existing) => existing.id !== template.id);
      props.onTemplates([template, ...others]);
      setDraft((prev) => ({ ...prev, id: template.id }));
      setSaved("Template saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  };

  const updateField = (index: number, next: SheetField) => {
    const fields = [...draft().fields];
    fields[index] = next;
    patch({ fields });
  };
  const updateStat = (index: number, next: StatDefinition) => {
    const stats = [...draft().stats];
    stats[index] = next;
    patch({ stats });
  };
  const updateTicker = (index: number, next: TickerDefinition) => {
    const tickers = [...draft().tickers];
    tickers[index] = next;
    patch({ tickers });
  };
  const updateRoll = (index: number, next: RollDefinition) => {
    const rolls = [...draft().rolls];
    rolls[index] = next;
    patch({ rolls });
  };

  return (
    <div>
      <div {...sx(styles.row)}>
        <select
          {...sx(styles.select)}
          aria-label="Template"
          value={draft().id ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const template = props.templates.find((item) => item.id === value);
            setSaved("");
            if (template) loadTemplate(template);
            else if (value.startsWith("preset:")) {
              const preset = presets[Number(value.slice(7))];
              setDraft({ ...preset, layout: preset.layout && structuredClone(preset.layout) });
              setSaved(`Started from “${preset.name}”. Adjust it, then save.`);
            } else setDraft(emptyTemplate());
          }}
        >
          <option value="">New blank template…</option>
          <For each={props.templates}>
            {(template) => <option value={template.id}>{template.name}</option>}
          </For>
          <optgroup label="Start from a premade layout">
            <For each={presets}>
              {(preset, index) => <option value={`preset:${index()}`}>{preset.name}</option>}
            </For>
          </optgroup>
        </select>
        <div {...sx(styles.spacer)} />
        <Button small onClick={exportDraft}>
          Export
        </Button>
        <label {...sx(styles.button, styles.buttonSmall)}>
          Import
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <Button variant="primary" small disabled={busy()} onClick={save}>
          {busy() ? "Saving..." : "Save template"}
        </Button>
      </div>
      <div {...sx(styles.divider)} />
      <ErrorBanner message={error()} />
      <Show when={saved()}>
        <div {...sx(styles.successBanner)}>{saved()}</div>
      </Show>

      <div {...sx(styles.col)}>
        <div {...sx(styles.rowWrap)}>
          <Field label="Template name">
            <Input value={draft().name} onInput={(value) => patch({ name: value })} />
          </Field>
          <Field label="Description">
            <Input
              value={draft().description ?? ""}
              onInput={(value) => patch({ description: value })}
            />
          </Field>
        </div>

        <Show
          when={draft().layout}
          fallback={
            <div {...sx(styles.successBanner)}>
              This template uses the classic sheet. Convert it to a layout to arrange blocks, add
              lists and checkboxes, and pick styles.{" "}
              <Button small onClick={() => patch({ layout: layoutFromTemplate(asTemplate()) })}>
                Convert to layout
              </Button>
            </div>
          }
        >
          {(layout) => (
            <LayoutEditor layout={layout()} onChange={(next) => patch({ layout: next })} />
          )}
        </Show>

        <details {...sx(styles.builderSection)} open={!draft().layout}>
          <summary {...sx(styles.eyebrow)} style={{ cursor: "pointer" }}>
            {draft().layout
              ? "Classic data — formulas and roll modifiers used by this layout"
              : "Classic sheet"}
          </summary>
          <section {...sx(styles.builderSection)}>
            <span {...sx(styles.eyebrow)}>Fields</span>
            <Headings style="fields" labels={["Label", "Type", "Group", ""]} />
            <For each={draft().fields}>
              {(field, index) => (
                <div {...sx(styles.builderRow, styles.builderFieldsGrid)}>
                  <LabelCell
                    label={field.label}
                    id={field.id}
                    onLabel={(label) =>
                      updateField(index(), {
                        ...field,
                        label,
                        id: isFresh("fields", field.id)
                          ? idFromLabel(label, draft().fields, index())
                          : field.id,
                      })
                    }
                  />
                  <select
                    {...sx(styles.select)}
                    value={field.kind}
                    onChange={(event) =>
                      updateField(index(), {
                        ...field,
                        kind: event.currentTarget.value as SheetFieldKind,
                      })
                    }
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="longtext">longtext</option>
                  </select>
                  <Input
                    value={field.group ?? ""}
                    onInput={(value) => updateField(index(), { ...field, group: value })}
                  />
                  <Button
                    small
                    variant="danger"
                    onClick={() =>
                      patch({ fields: draft().fields.filter((_, i) => i !== index()) })
                    }
                  >
                    ×
                  </Button>
                </div>
              )}
            </For>
            <Button
              small
              onClick={() =>
                patch({
                  fields: [
                    ...draft().fields,
                    { id: `field_${draft().fields.length + 1}`, label: "New field", kind: "text" },
                  ],
                })
              }
            >
              Add field
            </Button>
          </section>

          <section {...sx(styles.builderSection)}>
            <span {...sx(styles.eyebrow)}>Stats</span>
            <Headings style="stats" labels={["Label", "Base", ""]} />
            <For each={draft().stats}>
              {(stat, index) => (
                <div {...sx(styles.col)}>
                  <div {...sx(styles.builderRow, styles.builderStatsGrid)}>
                    <LabelCell
                      label={stat.label}
                      id={stat.id}
                      onLabel={(label) =>
                        updateStat(index(), {
                          ...stat,
                          label,
                          id: isFresh("stats", stat.id)
                            ? idFromLabel(label, draft().stats, index())
                            : stat.id,
                        })
                      }
                    />
                    <Input
                      type="number"
                      value={stat.base ?? 0}
                      onInput={(value) => updateStat(index(), { ...stat, base: Number(value) })}
                    />
                    <Button
                      small
                      variant="danger"
                      onClick={() =>
                        patch({ stats: draft().stats.filter((_, i) => i !== index()) })
                      }
                    >
                      ×
                    </Button>
                  </div>
                  <ModifierEditor
                    modifiers={[...stat.modifiers]}
                    stats={draft().stats}
                    fields={draft().fields}
                    onChange={(modifiers) => updateStat(index(), { ...stat, modifiers })}
                  />
                </div>
              )}
            </For>
            <Button
              small
              onClick={() =>
                patch({
                  stats: [
                    ...draft().stats,
                    {
                      id: `stat_${draft().stats.length + 1}`,
                      label: "New stat",
                      base: 0,
                      modifiers: [],
                    },
                  ],
                })
              }
            >
              Add stat
            </Button>
          </section>

          <section {...sx(styles.builderSection)}>
            <span {...sx(styles.eyebrow)}>Trackers</span>
            <Headings style="trackers" labels={["Label", "Min", "Max", "Start", "Display", ""]} />
            <For each={draft().tickers}>
              {(ticker, index) => (
                <div {...sx(styles.builderRow, builderStyles.trackersGrid)}>
                  <LabelCell
                    label={ticker.label}
                    id={ticker.id}
                    onLabel={(label) =>
                      updateTicker(index(), {
                        ...ticker,
                        label,
                        id: isFresh("tickers", ticker.id)
                          ? idFromLabel(label, draft().tickers, index())
                          : ticker.id,
                      })
                    }
                  />
                  <Input
                    type="number"
                    value={ticker.min}
                    onInput={(value) => updateTicker(index(), { ...ticker, min: Number(value) })}
                  />
                  <Input
                    type="number"
                    value={ticker.max}
                    onInput={(value) =>
                      updateTicker(index(), {
                        ...ticker,
                        max: Number(value),
                        defaultValue:
                          ticker.defaultValue === ticker.max ? Number(value) : ticker.defaultValue,
                      })
                    }
                  />
                  <Input
                    type="number"
                    value={ticker.defaultValue}
                    onInput={(value) =>
                      updateTicker(index(), { ...ticker, defaultValue: Number(value) })
                    }
                  />
                  <select
                    {...sx(styles.select)}
                    aria-label={`${ticker.label} display`}
                    value={ticker.display ?? "auto"}
                    onChange={(event) =>
                      updateTicker(index(), {
                        ...ticker,
                        display: event.currentTarget.value as TickerDefinition["display"],
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="pips">Pips</option>
                    <option value="bar">Bar</option>
                    <option value="number">Number</option>
                  </select>
                  <Button
                    small
                    variant="danger"
                    onClick={() =>
                      patch({ tickers: draft().tickers.filter((_, i) => i !== index()) })
                    }
                  >
                    ×
                  </Button>
                </div>
              )}
            </For>
            <Button
              small
              onClick={() =>
                patch({
                  tickers: [
                    ...draft().tickers,
                    {
                      id: `tracker_${draft().tickers.length + 1}`,
                      label: "New tracker",
                      min: 0,
                      max: 10,
                      defaultValue: 10,
                    },
                  ],
                })
              }
            >
              Add tracker
            </Button>
          </section>

          <section {...sx(styles.builderSection)}>
            <span {...sx(styles.eyebrow)}>Rolls</span>
            <For each={draft().rolls}>
              {(roll, index) => (
                <div {...sx(styles.col, styles.panel)}>
                  <div {...sx(styles.builderRow, styles.builderRollsGrid)}>
                    <LabelCell
                      label={roll.label}
                      id={roll.id}
                      onLabel={(label) =>
                        updateRoll(index(), {
                          ...roll,
                          label,
                          id: isFresh("rolls", roll.id)
                            ? idFromLabel(label, draft().rolls, index())
                            : roll.id,
                        })
                      }
                    />
                    <select
                      {...sx(styles.select)}
                      value={roll.visibility}
                      onChange={(event) =>
                        updateRoll(index(), {
                          ...roll,
                          visibility: event.currentTarget.value as Visibility,
                        })
                      }
                    >
                      <option value="public">public</option>
                      <option value="private">private</option>
                      <option value="dm">dm</option>
                    </select>
                    <Button
                      small
                      variant="danger"
                      onClick={() =>
                        patch({ rolls: draft().rolls.filter((_, i) => i !== index()) })
                      }
                    >
                      ×
                    </Button>
                  </div>
                  <span {...sx(styles.faint)}>Dice</span>
                  <DiceEditor
                    dice={[...roll.dice]}
                    onChange={(dice) => updateRoll(index(), { ...roll, dice })}
                  />
                  <span {...sx(styles.faint)}>Modifiers</span>
                  <ModifierEditor
                    modifiers={[...roll.modifiers]}
                    stats={draft().stats}
                    fields={draft().fields}
                    onChange={(modifiers) => updateRoll(index(), { ...roll, modifiers })}
                  />
                </div>
              )}
            </For>
            <Button
              small
              onClick={() =>
                patch({
                  rolls: [
                    ...draft().rolls,
                    {
                      id: slug(`roll_${draft().rolls.length + 1}`),
                      label: "New roll",
                      dice: [{ count: 1, sides: 20 }],
                      modifiers: [],
                      visibility: "public",
                    },
                  ],
                })
              }
            >
              Add roll
            </Button>
          </section>
        </details>
      </div>
    </div>
  );
}
