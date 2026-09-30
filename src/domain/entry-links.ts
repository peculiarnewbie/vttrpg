import { isEntryId } from "./entry-id";
import { parseNotation } from "./dice-notation";

/*
 * `[[Entry name]]` in chat, notes, and entry descriptions links to a compendium
 * entry by name. Links are plain text, so they survive export and renames only
 * miss (they fall back to the text); entries a member can't see never resolve.
 */

/*
 * Since phase 2 links also come as `[[ref:<entry id>|Label]]`: pickers and the
 * `[[` suggestions insert this form, so a link survives renames and tells two
 * entries with the same name apart. The label is what readers see (and what
 * shows if the entry is gone). `[[Name]]` still works, resolved by name.
 */

/*
 * `[[r:2d6+1|Damage]]` (or `[[r:2d6+1]]`) is an inline roll: text shows the
 * label (or the notation) as a button that rolls it. Notation that doesn't
 * parse stays plain text.
 */

export type LinkPart =
  | { kind: "text"; text: string }
  | { kind: "link"; name: string }
  | { kind: "ref"; id: string; label: string }
  | { kind: "roll"; notation: string; label?: string };

/** `[[ref:id|Label]]`; `|` and brackets are removed from the label. */
export const formatRefLink = (id: string, label: string): string =>
  `[[ref:${id}|${label.replace(/[|[\]]/g, "")}]]`;

/** `[[r:notation|Label]]`; label delimiters and newlines are removed. */
export const formatRollLink = (notation: string, label?: string): string =>
  `[[r:${notation}${label === undefined ? "" : `|${label.replace(/[|[\]\r\n]/g, "")}`}]]`;

/** Name links have 1–120 characters; ref and roll links allow longer payloads. */
export const ENTRY_LINK = /\[\[((?:ref:[^[\]\n]+\|[^[\]\n]*)|(?:r:[^[\]\n]*)|[^[\]\n]{1,120})\]\]/g;

export const splitEntryLinks = (text: string): LinkPart[] => {
  const parts: LinkPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(ENTRY_LINK)) {
    if (match.index > offset) parts.push({ kind: "text", text: text.slice(offset, match.index) });
    const name = match[1].trim();
    const separator = name.indexOf("|");
    const id = name.slice(4, separator);
    if (name.startsWith("r:")) {
      const payload = name.slice(2).trim();
      const labelSeparator = payload.lastIndexOf("|");
      if (parseNotation(payload).ok) {
        parts.push({ kind: "roll", notation: payload });
      } else if (labelSeparator >= 0 && parseNotation(payload.slice(0, labelSeparator).trim()).ok) {
        parts.push({
          kind: "roll",
          notation: payload.slice(0, labelSeparator).trim(),
          label: payload.slice(labelSeparator + 1).trim(),
        });
      } else {
        parts.push({ kind: "text", text: match[0] });
      }
    } else if (name.startsWith("ref:") && separator >= 0 && isEntryId(id)) {
      parts.push({ kind: "ref", id, label: name.slice(separator + 1).trim() });
    } else {
      parts.push({ kind: "link", name: name.startsWith("ref:") ? name.slice(4).trim() : name });
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ kind: "text", text: text.slice(offset) });
  return parts;
};

export const normalizeName = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The entry a link names (case-, accent-, and spacing-insensitive). */
export const findEntryByName = <T extends { name: string }>(
  entries: readonly T[],
  name: string,
) => {
  const wanted = normalizeName(name);
  return wanted ? entries.find((entry) => normalizeName(entry.name) === wanted) : undefined;
};

/** The unfinished `[[query` just before the caret, if the writer is typing a link. */
export const linkQueryAt = (text: string, caret: number) => {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start < 0) return undefined;
  const query = before.slice(start + 2);
  return /[[\]\n]/.test(query) || query.length > 60 ? undefined : { start, query };
};

/** Replace the typed `[[query` with a finished link and put the caret after it. */
export const insertLink = (
  text: string,
  caret: number,
  start: number,
  name: string,
  id?: string,
) => {
  const link = id === undefined ? `[[${name}]]` : formatRefLink(id, name);
  const after = text.slice(caret).replace(/^\]\]/, "");
  return { text: text.slice(0, start) + link + after, caret: start + link.length };
};
