import { expect, it } from "vitest";
import { renderNoteMarkdown } from "./note-markdown";

it("renders the supported markdown subset", () => {
  const html = renderNoteMarkdown(
    "# Journal\n\n**bold** and *italic* with `code`\nnext line\n\n- first\n- second\n\n1. ordered\n\n```\n<a>\n```\n\n[map](https://example.com)",
  );
  expect(html).toContain("<h1>Journal</h1>");
  expect(html).toContain(
    "<strong>bold</strong> and <em>italic</em> with <code>code</code><br>next line",
  );
  expect(html).toContain("<ul><li>first</li><li>second</li></ul>");
  expect(html).toContain("<ol><li>ordered</li></ol>");
  expect(html).toContain("<pre><code>&lt;a&gt;</code></pre>");
  expect(html).toContain('href="https://example.com"');
});

it("escapes HTML and attributes and rejects unsafe link protocols", () => {
  const html = renderNoteMarkdown(
    '<img src=x onerror=alert(1)>\n[x](javascript:alert) [x](data:text/html,bad) [x](https://x/"onmouseover="evil)\n`<script>`',
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
  expect(html).toContain("&quot;onmouseover=&quot;");
  expect(renderNoteMarkdown("[x](jav&#97;script:bad)")).not.toContain("<a ");
});

it("links [[entries]] the reader can open and leaves the rest as text", () => {
  const html = renderNoteMarkdown("Ask [[Example Knight]] about [[<Secret>]].", ({ name }) =>
    name === "Example Knight" ? 'ent_"1' : undefined,
  );
  expect(html).toBe(
    '<p>Ask <button type="button" class="ttrpg-entry-link" data-entry-id="ent_&quot;1">Example Knight</button> about <span class="ttrpg-entry-missing">&lt;Secret&gt;</span>.</p>',
  );
  expect(renderNoteMarkdown("[[Plain]]")).toBe(
    '<p><span class="ttrpg-entry-missing">Plain</span></p>',
  );
});

it("resolves references by id and displays escaped labels for visible and missing entries", () => {
  const seen: { name: string; id?: string }[] = [];
  const html = renderNoteMarkdown(
    "[[ref:world/spell/shield|<Old Shield>]] and [[ref:world/item/shield|Shield]]",
    (link) => {
      seen.push(link);
      return link.id === "world/spell/shield" ? link.id : undefined;
    },
  );
  expect(seen).toEqual([
    { name: "<Old Shield>", id: "world/spell/shield" },
    { name: "Shield", id: "world/item/shield" },
  ]);
  expect(html).toBe(
    '<p><button type="button" class="ttrpg-entry-link" data-entry-id="world/spell/shield">&lt;Old Shield&gt;</button> and <span class="ttrpg-entry-missing">Shield</span></p>',
  );
  expect(renderNoteMarkdown("[[ref:world/spell/shield|Shield]]")).toContain(
    'class="ttrpg-entry-missing">Shield',
  );
});

it("resolves malformed references as name links and handles long ids", () => {
  expect(
    renderNoteMarkdown("[[ref:ent_abc|Shield]]", ({ name, id }) => {
      expect(name).toBe("ent_abc|Shield");
      expect(id).toBeUndefined();
      return "legacy";
    }),
  ).toContain('data-entry-id="legacy">ent_abc|Shield');
  const id = Array(3).fill("x".repeat(60)).join("/");
  expect(renderNoteMarkdown(`[[ref:${id}|Long]]`, (link) => link.id)).toContain(
    `data-entry-id="${id}">Long`,
  );
});

it("renders labelled and unlabelled inline rolls as buttons without resolving entries", () => {
  const seen: string[] = [];
  expect(
    renderNoteMarkdown("[[r:2d6+1|Damage]] [[r:d%]]", ({ name }) => {
      seen.push(name);
      return undefined;
    }),
  ).toBe(
    '<p><button type="button" class="ttrpg-inline-roll" data-roll="2d6+1" data-label="Damage">Damage</button> <button type="button" class="ttrpg-inline-roll" data-roll="d%" data-label="d%">d%</button></p>',
  );
  expect(seen).toEqual([]);
  expect(renderNoteMarkdown("[[r:d6|]]")).toBe(
    '<p><button type="button" class="ttrpg-inline-roll" data-roll="d6" data-label=""></button></p>',
  );
});

it("escapes roll notation, labels, and invalid links without dropping or duplicating text", () => {
  expect(renderNoteMarkdown("before [[r:bad<script>|<img>]] after [[Plain]]")).toBe(
    '<p>before [[r:bad&lt;script&gt;|&lt;img&gt;]] after <span class="ttrpg-entry-missing">Plain</span></p>',
  );
  const html = renderNoteMarkdown("[[r:d6+@{a\"<>&'}|<img src=x onerror=\"evil\"> & 'text']]");
  expect(html).toContain('data-roll="d6+@{a&quot;&lt;&gt;&amp;&#39;}"');
  expect(html).toContain(
    'data-label="&lt;img src=x onerror=&quot;evil&quot;&gt; &amp; &#39;text&#39;"',
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain('onerror="evil"');
  expect(renderNoteMarkdown("`[[r:d6]]`\n\n```\n[[r:d6]]\n```")).not.toContain("ttrpg-inline-roll");
  expect(renderNoteMarkdown("[[r:]] middle [[r:d0]] end")).toBe(
    "<p>[[r:]] middle [[r:d0]] end</p>",
  );
});

it("renders pipe tables, dropping an empty header row, and blockquotes", () => {
  expect(
    renderNoteMarkdown(
      [
        "Roll for it:",
        "| d6 | Result |",
        "|:--:|--------|",
        "| **1** | A [[r:1d4|small]] thing |",
        "| 2 | x \\| y |",
        "",
        "|   |   |",
        "| - | - |",
        "| 1 | One |",
        "",
        "> You are an *artisan*.",
        "> Second line.",
      ].join("\n"),
    ),
  ).toBe(
    [
      "<p>Roll for it:</p>",
      '<table><thead><tr><th>d6</th><th>Result</th></tr></thead><tbody><tr><td><strong>1</strong></td><td>A <button type="button" class="ttrpg-inline-roll" data-roll="1d4" data-label="small">small</button> thing</td></tr><tr><td>2</td><td>x | y</td></tr></tbody></table>',
      "<table><tbody><tr><td>1</td><td>One</td></tr></tbody></table>",
      "<blockquote><p>You are an <em>artisan</em>.<br>Second line.</p></blockquote>",
    ].join("\n"),
  );
});

it("reads _underscores_ as italics only at word boundaries", () => {
  expect(renderNoteMarkdown("Gloves (_petty_), a snake_case_name and _two words_.")).toBe(
    "<p>Gloves (<em>petty</em>), a snake_case_name and <em>two words</em>.</p>",
  );
});
