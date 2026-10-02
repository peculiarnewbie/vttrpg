import { For, Show } from "solid-js";
import { moveIndex } from "../client/sortable";
import { builderParts } from "../domain/builder-parts";
import type { EntryType } from "../domain/compendium";
import type { Expr, Scalar, Term } from "../domain/derived";
import { formulaRefs } from "../domain/formula-help";
import {
  isKnownPart,
  type BuilderPart,
  type BuilderStep,
  type SheetLayout,
  type StoredBuilderPart,
} from "../domain/sheet-layout";
import { sx } from "../theme/sx";
import { partView } from "./builder-parts";
import { e, TextInput } from "./editor-kit";
import { FormulaInput } from "./formula-input";
import { styles } from "./styles.stylex";

/*
 * The optional character builder in the layout editor: steps over this
 * layout's blocks (see `SheetBuilder`). Steps hold references, not copies — a
 * removed block just drops out of its step, and the problems list says so.
 * Each part kind's editor comes from the registry (builder-parts).
 */

type Preview = (expr: Expr) => { value: Scalar; terms: readonly Term[] } | undefined;

const moveItem = <T,>(items: readonly T[], index: number, delta: -1 | 1): T[] =>
  index + delta < 0 || index + delta >= items.length
    ? [...items]
    : moveIndex(items, index, index + delta);

export function BuilderEditor(props: {
  layout: SheetLayout;
  entryTypes: readonly EntryType[];
  /** A formula's value on the preview sheet, for conditions. */
  preview?: Preview;
  onChange: (layout: SheetLayout) => void;
}) {
  const steps = () => props.layout.builder?.steps ?? [];
  const setSteps = (next: readonly BuilderStep[]) =>
    props.onChange({ ...props.layout, builder: next.length ? { steps: next } : undefined });
  const setStep = (index: number, step: BuilderStep) =>
    setSteps(steps().map((item, i) => (i === index ? step : item)));
  const freshStepId = () => {
    const ids = new Set(steps().map((step) => step.id));
    let n = steps().length + 1;
    while (ids.has(`step-${n}`)) n += 1;
    return `step-${n}`;
  };
  return (
    <div {...sx(e.column)} role="group" aria-label="Character builder steps">
      <span {...sx(e.itemHead)}>Character builder</span>
      <span {...sx(e.hint)}>
        Optional steps that fill in this same sheet: its blocks, picks from the compendium, and roll
        buttons. Rolls only go to chat; players write in what they keep.
      </span>
      <For each={steps()}>
        {(step, index) => (
          <StepEditor
            step={step}
            number={index() + 1}
            layout={props.layout}
            entryTypes={props.entryTypes}
            preview={props.preview}
            onChange={(next) => setStep(index(), next)}
            onMove={(delta) => setSteps(moveItem(steps(), index(), delta))}
            onRemove={() => setSteps(steps().filter((_, i) => i !== index()))}
          />
        )}
      </For>
      <button
        {...sx(styles.button, styles.buttonSmall)}
        onClick={() => setSteps([...steps(), { id: freshStepId(), title: "", parts: [] }])}
      >
        + Add a step
      </button>
    </div>
  );
}

/** An optional condition: a formula that's true while the step or part applies. */
function Condition(props: {
  /** Shown above the field. */
  text: string;
  /** The field's accessible name, naming its step. */
  label: string;
  value?: string;
  placeholder: string;
  layout: SheetLayout;
  preview?: Preview;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label {...sx(e.field)}>
      {props.text}
      <FormulaInput
        condition
        label={props.label}
        value={props.value ?? ""}
        placeholder={props.placeholder}
        suggestions={formulaRefs(props.layout)}
        preview={props.preview}
        onInput={(value) => props.onChange(value.trim() ? value : undefined)}
      />
    </label>
  );
}

function StepEditor(props: {
  step: BuilderStep;
  number: number;
  layout: SheetLayout;
  entryTypes: readonly EntryType[];
  preview?: Preview;
  onChange: (step: BuilderStep) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = () => `Step ${props.number}`;
  const setParts = (parts: readonly StoredBuilderPart[]) =>
    props.onChange({ ...props.step, parts });
  const setPart = (index: number, part: StoredBuilderPart) =>
    setParts(props.step.parts.map((item, i) => (i === index ? part : item)));
  return (
    <div {...sx(e.stepCard)} role="group" aria-label={name()}>
      <div {...sx(e.bar)}>
        <span {...sx(e.itemHead)}>{name()}</span>
        <div {...sx(styles.spacer)} />
        <button {...sx(e.icon)} aria-label={`Move ${name()} up`} onClick={() => props.onMove(-1)}>
          ↑
        </button>
        <button {...sx(e.icon)} aria-label={`Move ${name()} down`} onClick={() => props.onMove(1)}>
          ↓
        </button>
        <button {...sx(e.icon)} aria-label={`Remove ${name()}`} onClick={props.onRemove}>
          ×
        </button>
      </div>
      <TextInput
        label="Title"
        value={props.step.title}
        onInput={(title) => props.onChange({ ...props.step, title })}
      />
      <TextInput
        label="Hint (your own words)"
        value={props.step.hint ?? ""}
        onInput={(hint) => props.onChange({ ...props.step, hint: hint || undefined })}
      />
      <div {...sx(e.bar)}>
        <Condition
          text="Applies when"
          label={`${name()} applies when`}
          placeholder="always (e.g. @level >= 3)"
          value={props.step.when}
          layout={props.layout}
          preview={props.preview}
          onChange={(when) => props.onChange({ ...props.step, when })}
        />
        <Condition
          text="Done when"
          label={`${name()} is done when`}
          placeholder='e.g. @background != ""'
          value={props.step.done}
          layout={props.layout}
          preview={props.preview}
          onChange={(done) => props.onChange({ ...props.step, done })}
        />
      </div>
      <For each={props.step.parts}>
        {(part, index) => (
          <div {...sx(e.partCard)}>
            <div {...sx(e.bar)}>
              <span {...sx(e.itemHead)}>
                {isKnownPart(part) ? builderParts[part.type].label : `“${part.type}” (kept as is)`}
              </span>
              <div {...sx(styles.spacer)} />
              <button
                {...sx(e.icon)}
                aria-label={`Move ${name()} part ${index() + 1} up`}
                onClick={() => setParts(moveItem(props.step.parts, index(), -1))}
              >
                ↑
              </button>
              <button
                {...sx(e.icon)}
                aria-label={`Remove ${name()} part ${index() + 1}`}
                onClick={() => setParts(props.step.parts.filter((_, i) => i !== index()))}
              >
                ×
              </button>
            </div>
            <Show
              when={isKnownPart(part) ? part : undefined}
              fallback={
                <span {...sx(e.hint)}>
                  This version can't edit this kind of part; it stays in the layout unchanged.
                </span>
              }
            >
              {(known) => (
                <>
                  <PartEditor
                    part={known()}
                    label={`${name()} part ${index() + 1}`}
                    layout={props.layout}
                    entryTypes={props.entryTypes}
                    onChange={(next) => setPart(index(), next)}
                  />
                  <Condition
                    text="Applies when"
                    label={`${name()} part ${index() + 1} applies when`}
                    placeholder="always"
                    value={known().when}
                    layout={props.layout}
                    preview={props.preview}
                    onChange={(when) => setPart(index(), { ...known(), when })}
                  />
                </>
              )}
            </Show>
          </div>
        )}
      </For>
      <select
        {...sx(styles.select, e.small)}
        aria-label={`Add to ${name()}`}
        value=""
        onChange={(event) => {
          const type = event.currentTarget.value as BuilderPart["type"];
          event.currentTarget.value = "";
          if (type) setParts([...props.step.parts, builderParts[type].blank(props.layout)]);
        }}
      >
        <option value="">Add to this step…</option>
        <For each={Object.entries(builderParts)}>
          {([type, kind]) => <option value={type}>{kind.label}</option>}
        </For>
      </select>
    </div>
  );
}

function PartEditor(props: {
  part: BuilderPart;
  label: string;
  layout: SheetLayout;
  entryTypes: readonly EntryType[];
  onChange: (part: BuilderPart) => void;
}) {
  // A part keeps its kind for as long as it's edited.
  const Editor = partView(props.part.type).Editor;
  return (
    <Editor
      part={props.part as never}
      label={props.label}
      layout={props.layout}
      entryTypes={props.entryTypes}
      onChange={props.onChange as never}
    />
  );
}
