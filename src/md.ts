// 安全 Markdown 渲染：先转义全部 HTML，再按语法生成标签；链接/图片仅允许 http(s) 与站内 /uploads/
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u: string) => (/^(https?:\/\/|\/uploads\/)/i.test(u) ? u : "");

function inline(s: string): string {
  // s 已经过 esc；按占位符保护行内代码与图片/链接
  const stash: string[] = [];
  const keep = (html: string) => { stash.push(html); return `\u0001${stash.length - 1}\u0002`; };
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => keep(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const u = safeUrl(url);
    return u ? keep(`<img src="${u}" alt="${alt}" loading="lazy"/>`) : keep(esc(alt));
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, url) => {
    const u = safeUrl(url);
    return u ? keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`) : t;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0001(\d+)\u0002/g, (_m, i) => stash[Number(i)] || "");
  return s;
}

export function renderMarkdown(src: string): string {
  const lines = esc(src || "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let listTag: string | null = null;
  const closeList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = null; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push("<hr/>"); i++; continue; }
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^&gt;\s?(.*)$/);
        if (!m) break;
        buf.push(inline(m[1])); i++;
      }
      out.push(`<blockquote>${buf.join("<br/>")}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (listTag !== tag) { closeList(); listTag = tag; out.push(`<${tag}>`); }
      out.push(`<li>${inline((ul || ol)![1])}</li>`);
      i++; continue;
    }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

export function excerpt(content: string, n = 220): string {
  const text = (content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*`\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

export function firstImage(content: string): string {
  const m = (content || "").match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  if (!m) return "";
  const u = m[1];
  return /^(https?:\/\/|\/uploads\/)/i.test(u) ? u : "";
}
