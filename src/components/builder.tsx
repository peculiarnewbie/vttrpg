import { For, Show, createSignal } from "solid-js";
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
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

const slug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "field";

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
    props.templates[0]
      ? {
          id: props.templates[0].id,
          name: props.templates[0].name,
          description: props.templates[0].description,
          fields: [...props.templates[0].fields],
          stats: [...props.templates[0].stats],
          tickers: [...props.templates[0].tickers],
          rolls: [...props.templates[0].rolls],
        }
      : emptyTemplate(),
  );
  const [error, setError] = createSignal("");
  const [saved, setSaved] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const patch = (partial: Partial<SaveTemplateInput>) =>
    setDraft((prev) => ({ ...prev, ...partial }));

  const loadTemplate = (template: SheetTemplate) =>
    setDraft({
      id: template.id,
      name: template.name,
      description: template.description,
      fields: [...template.fields],
      stats: [...template.stats],
      tickers: [...template.tickers],
      rolls: [...template.rolls],
    });

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
        <h3 {...sx(styles.h3)}>Sheet builder</h3>
        <div {...sx(styles.spacer)} />
        <select
          {...sx(styles.select)}
          value={draft().id ?? ""}
          onChange={(event) => {
            const template = props.templates.find((item) => item.id === event.currentTarget.value);
            if (template) loadTemplate(template);
            else setDraft(emptyTemplate());
          }}
        >
          <option value="">New template…</option>
          <For each={props.templates}>
            {(template) => <option value={template.id}>{template.name}</option>}
          </For>
        </select>
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

        <section {...sx(styles.builderSection)}>
          <span {...sx(styles.eyebrow)}>Fields</span>
          <For each={draft().fields}>
            {(field, index) => (
              <div {...sx(styles.builderRow)}>
                <Input
                  value={field.label}
                  onInput={(value) => updateField(index(), { ...field, label: value })}
                />
                <Input
                  value={field.id}
                  onInput={(value) => updateField(index(), { ...field, id: value })}
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
                  onClick={() => patch({ fields: draft().fields.filter((_, i) => i !== index()) })}
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
          <For each={draft().stats}>
            {(stat, index) => (
              <div {...sx(styles.col)}>
                <div {...sx(styles.builderRow)}>
                  <Input
                    value={stat.label}
                    onInput={(value) => updateStat(index(), { ...stat, label: value })}
                  />
                  <Input
                    value={stat.id}
                    onInput={(value) => updateStat(index(), { ...stat, id: value })}
                  />
                  <Input
                    type="number"
                    value={stat.base ?? 0}
                    onInput={(value) => updateStat(index(), { ...stat, base: Number(value) })}
                  />
                  <span />
                  <Button
                    small
                    variant="danger"
                    onClick={() => patch({ stats: draft().stats.filter((_, i) => i !== index()) })}
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
          <For each={draft().tickers}>
            {(ticker, index) => (
              <div {...sx(styles.builderRow)}>
                <Input
                  value={ticker.label}
                  onInput={(value) => updateTicker(index(), { ...ticker, label: value })}
                />
                <Input
                  value={ticker.id}
                  onInput={(value) => updateTicker(index(), { ...ticker, id: value })}
                />
                <Input
                  type="number"
                  value={ticker.min}
                  onInput={(value) => updateTicker(index(), { ...ticker, min: Number(value) })}
                />
                <Input
                  type="number"
                  value={ticker.max}
                  onInput={(value) => updateTicker(index(), { ...ticker, max: Number(value) })}
                />
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
                <div {...sx(styles.builderRowRoll)}>
                  <Input
                    value={roll.label}
                    onInput={(value) => updateRoll(index(), { ...roll, label: value })}
                  />
                  <Input
                    value={roll.id}
                    onInput={(value) => updateRoll(index(), { ...roll, id: value })}
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
                    onClick={() => patch({ rolls: draft().rolls.filter((_, i) => i !== index()) })}
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
      </div>
    </div>
  );
}
