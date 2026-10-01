import { ENTRY_LINK, splitEntryLinks } from "../domain/entry-links";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

/** Resolves a name or id link to an entry id the reader may open, or undefined. */
export type EntryLinkResolver = (link: { name: string; id?: string }) => string | undefined;

function inline(text: string, entryLink?: EntryLinkResolver): string {
  const pattern = new RegExp(
    ENTRY_LINK.source + /|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\)/.source,
    "g",
  );
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(offset, match.index));
    if (match[1] !== undefined) {
      const part = splitEntryLinks(match[0])[0];
      if (part.kind === "text") {
        result += escapeHtml(part.text);
        offset = match.index + match[0].length;
        continue;
      }
      if (part.kind === "roll") {
        const label = part.label ?? part.notation;
        result += `<button type="button" class="ttrpg-inline-roll" data-roll="${escapeHtml(part.notation)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
        offset = match.index + match[0].length;
        continue;
      }
      const name = part.kind === "ref" ? part.label : part.name;
      const id = entryLink?.(part.kind === "ref" ? { name, id: part.id } : { name });
      result += id
        ? `<button type="button" class="ttrpg-entry-link" data-entry-id="${escapeHtml(id)}">${escapeHtml(name)}</button>`
        : `<span class="ttrpg-entry-missing">${escapeHtml(name)}</span>`;
    } else if (match[2] !== undefined) result += `<code>${escapeHtml(match[2])}</code>`;
    else if (match[3] !== undefined) result += `<strong>${escapeHtml(match[3])}</strong>`;
    else if (match[4] !== undefined) result += `<em>${escapeHtml(match[4])}</em>`;
    else if (/^https?:\/\//i.test(match[6]) || /^mailto:/i.test(match[6])) {
      result += `<a href="${escapeHtml(match[6])}" rel="noreferrer noopener">${escapeHtml(match[5])}</a>`;
    } else result += escapeHtml(match[0]);
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(offset));
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** Cells split on `|`, except escaped `\|` and pipes inside `[[ref:…|…]]` / `[[r:…|…]]` links. */
const tableRow = (line: string) => {
  const text = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (text.startsWith("[[", i)) {
      depth++;
      cell += "[[";
      i++;
    } else if (text.startsWith("]]", i) && depth > 0) {
      depth--;
      cell += "]]";
      i++;
    } else if (text[i] === "|" && depth === 0) {
      cells.push(cell.trim());
      cell = "";
    } else cell += text[i];
  }
  return [...cells, cell.trim()];
};
const startsTable = (lines: readonly string[], index: number) =>
  lines[index]?.trimStart().startsWith("|") && TABLE_SEPARATOR.test(lines[index + 1] ?? "");
const startsBlock = (lines: readonly string[], index: number) =>
  /^(?:#{1,6} |[-*] |\d+\. |```|>)/.test(lines[index]) || startsTable(lines, index);

// All user text is escaped; only the tags above and below can become HTML.
export function renderNoteMarkdown(source: string, entryLink?: EntryLinkResolver): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    if (startsTable(lines, index - 1)) {
      // GFM pipe table; an all-empty header row (common in rulebook tables) is dropped.
      const header = tableRow(line);
      index++;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trimStart().startsWith("|"))
        rows.push(tableRow(lines[index++]));
      const cells = (row: string[], tag: "th" | "td") =>
        row.map((cell) => `<${tag}>${inline(cell, entryLink)}</${tag}>`).join("");
      const head = header.some(Boolean) ? `<thead><tr>${cells(header, "th")}</tr></thead>` : "";
      output.push(
        `<table>${head}<tbody>${rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table>`,
      );
    } else if (line.startsWith(">")) {
      const quoted = [line];
      while (index < lines.length && lines[index].startsWith(">")) quoted.push(lines[index++]);
      output.push(
        `<blockquote>${renderNoteMarkdown(quoted.map((item) => item.replace(/^> ?/, "")).join("\n"), entryLink)}</blockquote>`,
      );
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = line.indexOf(" ");
      output.push(`<h${level}>${inline(line.slice(level + 1), entryLink)}</h${level}>`);
    } else if (/^(?:[-*] |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line);
      const pattern = ordered ? /^\d+\. / : /^[-*] /;
      const items = [line];
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++]);
      const tag = ordered ? "ol" : "ul";
      output.push(
        `<${tag}>${items.map((item) => `<li>${inline(item.replace(pattern, ""), entryLink)}</li>`).join("")}</${tag}>`,
      );
    } else if (line.trim()) {
      const paragraph = [line];
      while (index < lines.length && lines[index].trim() && !startsBlock(lines, index))
        paragraph.push(lines[index++]);
      output.push(`<p>${paragraph.map((line) => inline(line, entryLink)).join("<br>")}</p>`);
    }
  }
  return output.join("\n");
}
