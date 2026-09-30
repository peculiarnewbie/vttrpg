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
  const html = renderNoteMarkdown("Ask [[Example Knight]] about [[<Secret>]].", (name) =>
    name === "Example Knight" ? 'ent_"1' : undefined,
  );
  expect(html).toBe(
    '<p>Ask <button type="button" class="ttrpg-entry-link" data-entry-id="ent_&quot;1">Example Knight</button> about <span class="ttrpg-entry-missing">&lt;Secret&gt;</span>.</p>',
  );
  expect(renderNoteMarkdown("[[Plain]]")).toBe(
    '<p><span class="ttrpg-entry-missing">Plain</span></p>',
  );
});
