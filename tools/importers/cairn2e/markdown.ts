import { parseNotation } from "../../../src/domain/dice-notation";
import { slugify } from "../../../src/domain/entry-id";

export type Section = { name: string; body: string; anchor: string };
export type Page = { path: string; title: string; body: string };
export type MarkdownTable = {
  heading: string;
  anchor: string;
  context: string;
  headers: string[];
  rows: string[][];
  markdown: string;
};

export const plain = (text: string) => text.replace(/\*|_/g, "").trim();
export const anchor = (text: string) =>
  plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

export const pageFrom = (path: string, raw: string): Page => {
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const body = raw
    .slice(front?.[0].length ?? 0)
    .split("\n")
    .filter((line) => !/!\[|\/img\//.test(line))
    .join("\n")
    .replace(/\{:[^}]*\}/g, "")
    .replace(/^- \[[ x]\] /gm, "- ")
    .trim();
  const title =
    front?.[1].match(/^title:\s*(.+)$/m)?.[1] ?? body.match(/^# (.+)/m)?.[1] ?? slugify(path);
  return { path, title: title.trim(), body };
};

export const sections = (body: string): Section[] => {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  const intro = body
    .slice(0, matches[0]?.index ?? body.length)
    .replace(/^# .+\n?/, "")
    .trim();
  return [
    ...(intro ? [{ name: "Introduction", body: intro, anchor: "" }] : []),
    ...matches.map((match, index) => ({
      name: match[1].trim(),
      anchor: anchor(match[1]),
      body: body
        .slice(match.index! + match[0].length, matches[index + 1]?.index ?? body.length)
        .trim(),
    })),
  ];
};

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
const separator = (line: string) => /^\s*\|?\s*:?-{3,}/.test(line);
const numeric = (cell: string) => /^\d+(?:[-–]\d+)?$/.test(plain(cell));

export const tables = (body: string): MarkdownTable[] => {
  const lines = body.split("\n");
  const result: MarkdownTable[] = [];
  let heading = "";
  let context = "";
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6} (.+)/);
    if (h) {
      heading = h[1].trim();
      context = "";
    }
    if (!lines[i].trim().startsWith("|") || !separator(lines[i + 1] ?? "")) {
      context += `${lines[i]}\n`;
      continue;
    }
    let headers = cells(lines[i]);
    const rows: string[][] = [];
    i += 2;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(cells(lines[i]));
      i++;
    }
    i--;
    if (
      rows[0] &&
      !numeric(rows[0][0]) &&
      (/^\d*d\d+$/.test(plain(rows[0][0])) ||
        (headers.every((header) => !header) && /^\*\*.+\*\*$/.test(rows[0][0])))
    )
      headers = rows.shift()!;
    const markdown = [headers, headers.map(() => "---"), ...rows]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
    result.push({ heading, anchor: anchor(heading), context, headers, rows, markdown });
  }
  return result;
};

export const normalizeTables = (body: string) => {
  // Upstream puts some header rows after the separator; GFM requires them before it.
  return body.replace(
    /(^\|[^\n]*\n\|\s*:?-{3,}[^\n]*\n(?:\|[^\n]*\n?)+)/gm,
    (block) => tables(block)[0]?.markdown + "\n",
  );
};

export const rollText = (text: string) =>
  text
    .split("\n")
    .map((line) => {
      return line.replace(
        /(\[\[(?:r|ref):[^\n]*?\]\])|(?<![A-Za-z0-9])(\d*d\d+(?:\s*[+-]\s*\d+)?)(?![A-Za-z0-9])/gi,
        (match: string, token: string | undefined, dice: string, offset: number) => {
          if (token) return match;
          const before = line.slice(Math.max(0, offset - 45), offset);
          const after = line.slice(offset + dice.length, offset + dice.length + 35);
          if (
            !/roll|restore|heal|lose|loss|recover|cures|takes|additional|dealing|deals|becomes|transform into/i.test(
              before,
            ) &&
            !/damage|STR|DEX|WIL|gold (?:coins|pieces)/i.test(after)
          )
            return dice;
          const notation = dice.replace(/\s/g, "");
          return parseNotation(notation).ok ? `[[r:${notation}|${dice}]]` : dice;
        },
      );
    })
    .join("\n");
