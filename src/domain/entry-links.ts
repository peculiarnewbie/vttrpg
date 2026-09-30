import type { CompendiumEntry } from "./compendium";

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

export type LinkPart =
  | { kind: "text"; text: string }
  | { kind: "link"; name: string }
  | { kind: "ref"; id: string; label: string };

/** `[[ref:id|Label]]`; `|` and brackets are removed from the label. */
export const formatRefLink = (_id: string, _label: string): string => {
  throw new Error("not implemented");
};

/** Matches `[[name]]`: 1–120 characters, no brackets or line breaks inside. */
export const ENTRY_LINK = /\[\[([^[\]\n]{1,120})\]\]/g;

export const splitEntryLinks = (text: string): LinkPart[] => {
  const parts: LinkPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(ENTRY_LINK)) {
    if (match.index > offset) parts.push({ kind: "text", text: text.slice(offset, match.index) });
    parts.push({ kind: "link", name: match[1].trim() });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ kind: "text", text: text.slice(offset) });
  return parts;
};

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The entry a link names (case-, accent-, and spacing-insensitive). */
export const findEntryByName = (entries: readonly CompendiumEntry[], name: string) => {
  const wanted = normalize(name);
  return wanted ? entries.find((entry) => normalize(entry.name) === wanted) : undefined;
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
export const insertLink = (text: string, caret: number, start: number, name: string) => {
  const link = `[[${name}]]`;
  const after = text.slice(caret).replace(/^\]\]/, "");
  return { text: text.slice(0, start) + link + after, caret: start + link.length };
};
