function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[character]));
}

function renderInline(value) {
  return value.split(/(`[^`]+`)/g).map(part => {
    if (part.startsWith("`") && part.endsWith("`")) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    let output = escapeHtml(part);
    let markerPrefix = "\uE000";
    while (part.includes(markerPrefix)) markerPrefix += "\uE000";
    const links = [];
    // Markdown images remain text; only task attachments use the authenticated image proxy.
    output = output.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g, (match, prefix, label, href) => {
      if (!/^(?:https?:\/\/|mailto:)/i.test(href)) return match;
      const marker = `${markerPrefix}${links.length}\uE001`;
      links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return `${prefix}${marker}`;
    });
    output = output.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
    for (let index = 0; index < links.length; index += 1) {
      output = output.replace(`${markerPrefix}${index}\uE001`, links[index]);
    }
    return output;
  }).join("");
}

export function renderMarkdown(value) {
  const lines = String(value ?? "").split("\n");
  let inList = false;
  const rendered = [];
  for (const line of lines) {
    if (/^[-*] /.test(line)) {
      if (!inList) { rendered.push("<ul>"); inList = true; }
      rendered.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) { rendered.push("</ul>"); inList = false; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      rendered.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (/^\s*(?:---+|___+)\s*$/.test(line)) {
      rendered.push("<hr>");
    } else if (line.trim()) {
      rendered.push(`<p>${renderInline(line)}</p>`);
    }
  }
  if (inList) rendered.push("</ul>");
  return rendered.join("");
}
