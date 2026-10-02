import * as stylex from "@stylexjs/stylex";
import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";
import { formulaHolds } from "../domain/sheet-refs";
import {
  isKnownPart,
  type BuilderPart,
  type BuilderStep,
  type StoredBuilderPart,
} from "../domain/sheet-layout";
import { colors, fontSize, fonts, space } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { partView, type BuilderActions, type BuilderContext } from "./builder-parts";
import { parts } from "./builder-parts/parts.stylex";
import { styles } from "./styles.stylex";
import { Button } from "./ui";

export type { BuilderCompendium } from "./builder-parts";

/*
 * A step-by-step way to fill in the same character the sheet edits — another
 * frontend over the same values, not a second system. It writes only on an
 * explicit edit (typing, choosing, accepting an offer); its rolls and table
 * rolls go to chat like any roll and never land on the sheet, so opening it on
 * a finished character can't change anything by accident. Steps can be taken
 * in any order and skipped; counts are hints, nothing is checked. Parts are
 * kinds from a registry (builder-parts), reading `context` and writing only
 * through `actions`.
 */

type Props = {
  context: BuilderContext;
  actions: BuilderActions;
  /** Sheet blocks, rendered as on the sheet (in edit mode). */
  renderBlocks: (ids: readonly string[]) => JSX.Element;
};

export function CharacterBuilder(props: Props) {
  const steps = () => props.context.layout.builder?.steps ?? [];
  const [index, setIndex] = createSignal(0);
  const step = () => steps()[Math.min(index(), steps().length - 1)];
  const applies = (item: BuilderStep) => formulaHolds(item.when, props.context.scope());
  const done = (item: BuilderStep) => formulaHolds(item.done, props.context.scope(), false);
  // Back and Next pass over steps that don't apply to this character.
  const next = (from: number, delta: 1 | -1) => {
    for (let at = from + delta; at >= 0 && at < steps().length; at += delta)
      if (applies(steps()[at])) return at;
    return undefined;
  };
  return (
    <section {...sx(b.builder)} aria-label="Character builder">
      <nav {...sx(b.steps)} aria-label="Builder steps">
        <For each={steps()}>
          {(item, position) => (
            <button
              type="button"
              {...sx(
                b.stepButton,
                position() === index() && b.stepCurrent,
                !applies(item) && b.stepSkipped,
              )}
              aria-current={position() === index() ? "step" : undefined}
              onClick={() => setIndex(position())}
            >
              <span {...sx(b.stepNumber)}>{done(item) ? "✓" : position() + 1}</span>
              {item.title || `Step ${position() + 1}`}
            </button>
          )}
        </For>
      </nav>
      <Show when={step()}>
        {(current) => (
          <div {...sx(b.body)}>
            <h3 {...sx(b.title)}>{current().title || `Step ${index() + 1}`}</h3>
            <Show
              when={applies(current())}
              fallback={<p {...sx(styles.muted)}>This step doesn't apply to this character.</p>}
            >
              <Show when={current().hint}>
                <p {...sx(styles.muted, b.hint)}>{current().hint}</p>
              </Show>
              <For each={current().parts}>
                {(part) => (
                  <PartHost
                    {...props}
                    part={part}
                    navigate={(id) => {
                      const at = steps().findIndex((item) => item.id === id);
                      if (at >= 0) setIndex(at);
                    }}
                  />
                )}
              </For>
            </Show>
            <div {...sx(styles.row)}>
              <Show when={next(index(), -1) !== undefined}>
                <Button small onClick={() => setIndex(next(index(), -1)!)}>
                  ← Back
                </Button>
              </Show>
              <div {...sx(styles.spacer)} />
              <Show when={next(index(), 1) !== undefined}>
                <Button small onClick={() => setIndex(next(index(), 1)!)}>
                  Next →
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}

/** One part: its kind's view, or a note when this version doesn't know the kind. */
function PartHost(props: Props & { part: StoredBuilderPart; navigate: (stepId: string) => void }) {
  return (
    <Show
      when={isKnownPart(props.part) ? props.part : undefined}
      fallback={
        <p {...sx(parts.unsupported)}>
          This step has a “{props.part.type}” part, which this version can't show.
        </p>
      }
    >
      {(part) => (
        <Show when={formulaHolds(part().when, props.context.scope())}>
          <KnownPart {...props} part={part()} />
        </Show>
      )}
    </Show>
  );
}

function KnownPart(props: Props & { part: BuilderPart; navigate: (stepId: string) => void }) {
  // A part keeps its kind for as long as it's shown.
  const View = partView(props.part.type).View;
  return (
    <View
      part={props.part as never}
      context={props.context}
      actions={props.actions}
      renderBlocks={props.renderBlocks}
      navigate={props.navigate}
    />
  );
}

const b = stylex.create({
  builder: { display: "flex", flexDirection: "column", gap: space.x3 },
  steps: { display: "flex", flexWrap: "wrap", gap: space.x1 },
  stepButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x1,
    paddingBlock: "2px",
    paddingInline: space.x2,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: "transparent",
    color: colors.textMuted,
    fontSize: fontSize.caption,
    cursor: "pointer",
  },
  stepCurrent: { borderColor: colors.accent, color: colors.text },
  stepSkipped: { opacity: 0.55, textDecorationLine: "line-through" },
  stepNumber: { fontFamily: fonts.numeric, color: colors.accent },
  body: { display: "flex", flexDirection: "column", gap: space.x2 },
  title: { margin: 0, fontSize: fontSize.subheading },
  hint: { whiteSpace: "pre-wrap" },
});
