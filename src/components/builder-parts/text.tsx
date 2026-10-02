import * as stylex from "@stylexjs/stylex";
import { renderNoteMarkdown } from "../../client/note-markdown";
import { colors, fonts, space } from "../../theme/tokens.stylex";
import { sx } from "../../theme/sx";
import { linkedRow } from "../compendium";
import { e } from "../editor-kit";
import { styles } from "../styles.stylex";
import { Field, Textarea } from "../ui";
import type { PartEditorProps, PartViewProps } from "./types";

/*
 * Longer guidance in the DM's own words, rendered like a note: entry links
 * open the entry, and `[[r:2d6]]` rolls go to chat. It never writes to the
 * character — reading it changes nothing.
 */
export function TextView(props: PartViewProps<"text">) {
  const entryLink = (link: { name: string; id?: string }) =>
    linkedRow(props.context.compendium, link)?.id;
  // Entry links and inline rolls are plain HTML; one handler serves both.
  const open = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-entry-id], [data-roll]");
    if (target?.dataset.entryId) props.actions.openEntry?.(target.dataset.entryId);
    else if (target?.dataset.roll)
      props.actions.roll(target.dataset.label || target.dataset.roll, target.dataset.roll);
  };
  return (
    <div {...sx(t.wrap)} role="group" aria-label="Guidance">
      <div
        class={`ttrpg-note-markdown ${sx(t.body).class}`}
        innerHTML={renderNoteMarkdown(props.part.markdown, entryLink)}
        onClick={open}
      />
    </div>
  );
}

export function TextEditor(props: PartEditorProps<"text">) {
  return (
    <div {...sx(e.column)}>
      <Field label="Guidance">
        <Textarea
          value={props.part.markdown}
          placeholder="Write guidance in your own words…"
          onInput={(markdown) => props.onChange({ ...props.part, markdown })}
        />
      </Field>
      <span {...sx(styles.muted, e.hint)}>
        Your own words — never paste rules text from a book.
      </span>
    </div>
  );
}

const t = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.x1 },
  body: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "13px",
    lineHeight: 1.5,
    overflowWrap: "break-word",
  },
});
