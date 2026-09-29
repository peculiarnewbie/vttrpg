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

function inline(text: string): string {
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(offset, match.index));
    if (match[1] !== undefined) result += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2] !== undefined) result += `<strong>${escapeHtml(match[2])}</strong>`;
    else if (match[3] !== undefined) result += `<em>${escapeHtml(match[3])}</em>`;
    else if (/^https?:\/\//i.test(match[5]) || /^mailto:/i.test(match[5])) {
      result += `<a href="${escapeHtml(match[5])}" rel="noreferrer noopener">${escapeHtml(match[4])}</a>`;
    } else result += escapeHtml(match[0]);
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(offset));
}

// All user text is escaped; only the tags above and below can become HTML.
export function renderNoteMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = line.indexOf(" ");
      output.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
    } else if (/^(?:[-*] |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line);
      const pattern = ordered ? /^\d+\. / : /^[-*] /;
      const items = [line];
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++]);
      const tag = ordered ? "ol" : "ul";
      output.push(
        `<${tag}>${items.map((item) => `<li>${inline(item.replace(pattern, ""))}</li>`).join("")}</${tag}>`,
      );
    } else if (line.trim()) {
      const paragraph = [line];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(?:#|[-*] |\d+\. |```)/.test(lines[index])
      )
        paragraph.push(lines[index++]);
      output.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    }
  }
  return output.join("\n");
}
