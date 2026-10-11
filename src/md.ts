// 安全 Markdown 渲染：先转义全部 HTML，再按语法生成标签；链接/图片仅允许 http(s) 与站内 /uploads/
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u: string) => (/^(https?:\/\/|\/uploads\/)/i.test(u) ? u : "");

function inline(s: string): string {
  // s 已经过 esc；按占位符保护行内代码与图片/链接
  const stash: string[] = [];
  const keep = (html: string) => { stash.push(html); return `\u0001${stash.length - 1}\u0002`; };
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => keep(`<code>${c}</code>`));
  // 字体颜色标记 [color=#RRGGBB]文本[/color]：仅认「# + 恰好 6 位 hex」，其余写法一律按原文输出。
  // 整体先占位保护再还原，内部只保留已转义的纯文本（不再套强调语法），hex 经校验后才拼进 style，杜绝属性注入。
  s = s.replace(/\[color=#([0-9a-fA-F]{6})\]([^\n]*?)\[\/color\]/g, (_m, hex, inner) =>
    keep(`<span style="color:#${hex.toLowerCase()}">${inner}</span>`));
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
  // 循环还原：颜色 span 内部可能含更早占位的行内代码等，单次扫描还原不干净
  let prev = "";
  while (prev !== s) { prev = s; s = s.replace(/\u0001(\d+)\u0002/g, (_m, i) => stash[Number(i)] || ""); }
  return s;
}

export function renderMarkdown(src: string): string {
  const lines = esc(src || "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let listTag: string | null = null;
  const closeList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = null; } };
  // 独立图片段落归组：连续的「整行只有一张图」的段落（段间允许空行）合成一个九宫格容器；
  // 混排在文字中间的图片不拆，仍按普通段落渲染。1 张 cols-1 大图，2–4 张 cols-2 两列，5–9 张 cols-3 三列。
  const imgRun: string[] = [];
  const flushImgs = () => {
    if (!imgRun.length) return;
    const cols = imgRun.length === 1 ? 1 : imgRun.length <= 4 ? 2 : 3;
    out.push(`<div class="img-grid cols-${cols}">${imgRun.join("")}</div>`);
    imgRun.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    const imgLine = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imgLine && safeUrl(imgLine[2])) {
      closeList();
      imgRun.push(`<img src="${imgLine[2]}" alt="${imgLine[1]}" loading="lazy"/>`);
      i++; continue;
    }
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList(); flushImgs();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); flushImgs(); const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); flushImgs(); out.push("<hr/>"); i++; continue; }
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      closeList(); flushImgs();
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
      flushImgs();
      const tag = ul ? "ul" : "ol";
      if (listTag !== tag) { closeList(); listTag = tag; out.push(`<${tag}>`); }
      out.push(`<li>${inline((ul || ol)![1])}</li>`);
      i++; continue;
    }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList(); flushImgs();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList(); flushImgs();
  return out.join("\n");
}

// 摘要 HTML：合法颜色标记 [color=#RRGGBB]…[/color]（仅恰好 6 位 hex，与 renderMarkdown 同规则）
// 转成 <span style="color:#hex"> 参与渲染；非法/未配对标记仍按旧口径剥除标记文本。
// 截断按可见字符计量，颜色段作为整体保护——截断点若落在颜色段内部，
// 仍用完整的 span 包住能放下的部分，永远不会输出半截标记或裸原文。
export function excerpt(content: string, n = 220): string {
  const stash: { hex: string; text: string }[] = [];
  const keep = (hex: string, inner: string) => {
    const text = inner.replace(/[#>*`\-]/g, "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    stash.push({ hex: hex.toLowerCase(), text });
    return `\u0001${stash.length - 1}\u0002`;
  };
  const src = (content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[color=#([0-9a-fA-F]{6})\]([^\n]*?)\[\/color\]/g, (_m, hex: string, inner: string) => keep(hex, inner))
    .replace(/\[color=#[0-9a-fA-F]{6}\]/gi, "")
    .replace(/\[\/color\]/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*`\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // 可见总长度（占位符按其内部文本计）
  const visLen = (() => {
    let len = 0; let last = 0; let m: RegExpExecArray | null;
    const re = /\u0001(\d+)\u0002/g;
    while ((m = re.exec(src))) {
      len += m.index - last;
      const st = stash[Number(m[1])];
      if (st) len += st.text.length;
      last = m.index + m[0].length;
    }
    return len + (src.length - last);
  })();
  const truncated = visLen > n;
  // 拼装：纯文本按字符截断；颜色段整段保留，放不下时用 span 包住可放部分
  const parts: string[] = [];
  let vis = 0;
  let done = false;
  const re = /\u0001(\d+)\u0002/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (done || !t) return;
    const room = n - vis;
    if (room <= 0) { done = true; return; }
    if (t.length <= room) { parts.push(t); vis += t.length; }
    else { parts.push(t.slice(0, room)); vis = n; done = true; }
  };
  while ((m = re.exec(src)) && !done) {
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (done) break;
    const idx = Number(m[1]);
    const st = stash[idx];
    if (!st) continue;
    const room = n - vis;
    if (room <= 0) { done = true; break; }
    if (st.text.length <= room) { parts.push(m[0]); vis += st.text.length; }
    else { stash[idx] = { hex: st.hex, text: st.text.slice(0, room) }; parts.push(m[0]); vis = n; done = true; }
  }
  if (!done) pushText(src.slice(last));
  const html = parts.join("").replace(/\u0001(\d+)\u0002/g, (_mm, i) => {
    const st = stash[Number(i)];
    return st ? `<span style="color:#${st.hex}">${esc(st.text)}</span>` : "";
  });
  return truncated ? html + "…" : html;
}

export function firstImage(content: string): string {
  const m = (content || "").match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  if (!m) return "";
  const u = m[1];
  return /^(https?:\/\/|\/uploads\/)/i.test(u) ? u : "";
}

// 正文全部图片 URL（按出现顺序，仅 http(s) 与站内 /uploads/，与渲染口径一致）
export function imagesOf(content: string): string[] {
  const out: string[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  const src = content || "";
  while ((m = re.exec(src))) {
    if (/^(https?:\/\/|\/uploads\/)/i.test(m[2])) out.push(m[2]);
  }
  return out;
}

// 图片语法总数（上限校验用，与服务端同一正则口径）
export function countImages(content: string): number {
  return ((content || "").match(/!\[[^\]]*\]\([^)\s]+\)/g) || []).length;
}
