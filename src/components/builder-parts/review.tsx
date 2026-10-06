import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { reviewRows } from "../../domain/builder-review";
import { sx } from "../../theme/sx";
import { e } from "../editor-kit";
import { styles } from "../styles.stylex";
import { parts } from "./parts.stylex";
import type { PartViewProps } from "./types";

/*
 * What's still blank, step by step: one row per other step that applies,
 * with its done tick and the names still empty in it. Navigation only —
 * clicking a row goes to that step and writes nothing.
 */
export function ReviewView(props: PartViewProps<"review">) {
  const steps = () => props.context.layout.builder?.steps ?? [];
  const own = () => steps().find((step) => step.parts.some((item) => item === props.part));
  const rows = () =>
    reviewRows(props.context.layout, props.context.values, props.context.scope(), own()?.id);
  return (
    <div {...sx(parts.choose)} role="group" aria-label="Review">
      <Show when={rows().length} fallback={<p {...sx(styles.muted)}>Nothing else to fill in.</p>}>
        <ul {...sx(parts.options)} aria-label="Steps left">
          <For each={rows()}>
            {(row) => (
              <li>
                <button
                  type="button"
                  {...sx(parts.option)}
                  onClick={() => props.navigate(row.stepId)}
                >
                  <span>
                    <Show when={row.done}>
                      <span {...sx(parts.mark)}>✓ </span>
                    </Show>
                    {row.title}
                  </span>
                  <Show
                    when={row.blank.length}
                    fallback={<span {...sx(styles.muted)}>Nothing blank</span>}
                  >
                    <span {...sx(styles.muted)}>{row.blank.join(", ")}</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/** Nothing to set up beyond the part's own "applies when" — the step editor already has it. */
export function ReviewEditor(): JSX.Element {
  return <span {...sx(e.hint)}>Lists every other step that applies, with what's still blank.</span>;
}
