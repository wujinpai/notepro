import { useEffect, useRef, useState } from "react";
import { api, type NoteInfo } from "./api";
import { TagInput } from "./components";
import { countImages, renderMarkdown } from "./md";

const COLOR_PRESETS = ["#e03131", "#e8590c", "#f08c00", "#2f9e44", "#1098ad", "#1971c2", "#7048e8", "#d6336c"];

// WMO 天气码 → 中文（Open-Meteo current.weather_code）
const WMO_ZH: Record<number, string> = {
  0: "晴",
  1: "以晴为主", 2: "多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨",
  56: "冻毛毛雨", 57: "冻毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  66: "冻雨", 67: "冻雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
  80: "阵雨", 81: "阵雨", 82: "暴雨",
  85: "阵雪", 86: "阵雪",
  95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "雷阵雨伴冰雹",
};

export function EditorPage({ note, onSaved, onCancel }: {
  note: NoteInfo | null; onSaved: (n: NoteInfo) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [weather, setWeather] = useState(note?.weather || "");
  const [location, setLocation] = useState(note?.location || "");
  const [visibility, setVisibility] = useState(note?.visibility || "public");
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [archived, setArchived] = useState(!!note?.archived);
  const [allowComments, setAllowComments] = useState(note?.allowComments ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ tags: { name: string }[] }>("/api/tags?mine=1").then((d) => setSuggestions(d.tags.map((t) => t.name))).catch(() => undefined);
  }, []);

  const insertImage = async (file: File) => {
    if (countImages(content) >= 9) { setError("每篇独白最多 9 张图片，已达上限"); return; }
    setUploading(true);
    try {
      const r = await api.upload("/api/upload", file);
      const md = `\n![图片](${r.path})\n`;
      const ta = taRef.current;
      if (ta) {
        const s = ta.selectionStart;
        setContent(content.slice(0, s) + md + content.slice(s));
      } else setContent(content + md);
    } catch (e) { setError((e as Error).message); } finally { setUploading(false); }
  };

  // ---- Markdown 工具栏：在光标处插入/包裹语法，操作后焦点回输入框 ----
  const wrapSel = (before: string, after: string, placeholder: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = content.slice(s, e) || placeholder;
    setContent(content.slice(0, s) + before + sel + after + content.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      const start = s + before.length;
      ta.setSelectionRange(start, start + sel.length);
    });
  };

  const linePrefix = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = content.lastIndexOf("\n", s - 1) + 1;
    let lineEnd = content.indexOf("\n", e);
    if (lineEnd === -1) lineEnd = content.length;
    const block = content.slice(lineStart, lineEnd);
    const replaced = block.split("\n").map((l) => prefix + l).join("\n");
    setContent(content.slice(0, lineStart) + replaced + content.slice(lineEnd));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(lineStart, lineStart + replaced.length);
    });
  };

  const insertAt = (text: string) => {
    const ta = taRef.current;
    if (!ta) { setContent(content + text); return; }
    const s = ta.selectionStart;
    setContent(content.slice(0, s) + text + content.slice(ta.selectionEnd));
    requestAnimationFrame(() => {
      ta.focus();
      const p = s + text.length;
      ta.setSelectionRange(p, p);
    });
  };

  const insertLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const text = content.slice(s, e) || "链接文字";
    const snippet = `[${text}](https://)`;
    setContent(content.slice(0, s) + snippet + content.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      const urlStart = s + text.length + 3; // [text](
      ta.setSelectionRange(urlStart, urlStart + 8); // 选中 https:// 待替换
    });
  };

  // ---- 字体颜色：渲染端只认 [color=#RRGGBB]文本[/color]（6 位 hex 校验），见 md.ts ----
  const [colorOpen, setColorOpen] = useState(false);
  const [colorPos, setColorPos] = useState({ top: 0, left: 0 });
  const colorWrapRef = useRef<HTMLSpanElement>(null);

  const applyColor = (hex: string | null) => {
    const ta = taRef.current;
    setColorOpen(false);
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (hex === null) {
      // 恢复默认：剥掉正包着光标/选区的颜色标记，或剥掉选区内部的全部颜色标记
      const openM = content.slice(0, s).match(/\[color=#[0-9a-fA-F]{6}\]$/);
      if (openM && content.slice(e).startsWith("[/color]")) {
        const innerStart = s - openM[0].length;
        setContent(content.slice(0, innerStart) + content.slice(s, e) + content.slice(e + "[/color]".length));
        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(innerStart, innerStart + (e - s)); });
        return;
      }
      const sel = content.slice(s, e);
      const stripped = sel.replace(/\[color=#[0-9a-fA-F]{6}\]/gi, "").replace(/\[\/color\]/gi, "");
      if (stripped !== sel) {
        setContent(content.slice(0, s) + stripped + content.slice(e));
        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s, s + stripped.length); });
      }
      return;
    }
    const open = `[color=${hex}]`;
    if (s === e) {
      // 无选区：插入空包裹，光标停在中间待输入
      setContent(content.slice(0, s) + open + "[/color]" + content.slice(e));
      requestAnimationFrame(() => { ta.focus(); const p = s + open.length; ta.setSelectionRange(p, p); });
    } else {
      wrapSel(open, "[/color]", "彩色文字");
    }
  };

  const toggleColorPop = () => {
    if (colorOpen) { setColorOpen(false); return; }
    const btn = colorWrapRef.current?.querySelector("button");
    const r = btn?.getBoundingClientRect();
    if (r) {
      // 色板定宽 248px，左边缘钳在视口内，390px 下不溢出
      setColorPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 248 - 8)) });
    }
    setColorOpen(true);
  };

  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".color-pop") && !t.closest(".md-tool-wrap")) setColorOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setColorOpen(false); };
    const onMove = () => setColorOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [colorOpen]);

  // ---- 自动获取天气与位置：用户点一次，浏览器定位一次；坐标只发给两个公开接口，不存不报 ----
  const autoFillGeo = () => {
    if (!("geolocation" in navigator)) { setGeoMsg("当前环境不支持定位，请手动填写"); return; }
    setGeoBusy(true); setGeoMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(4);
        const lon = pos.coords.longitude.toFixed(4);
        void Promise.all([
          fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`)
            .then((r) => { if (!r.ok) throw new Error("geo"); return r.json(); }),
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)
            .then((r) => { if (!r.ok) throw new Error("wx"); return r.json(); }),
        ]).then(([g, w]) => {
          // 位置：取行政层级 adminLevel 4（市级，如"重庆市"→"重庆"），兜底 city/locality/principalSubdivision
          const admins: { adminLevel?: number; name?: string }[] = g?.localityInfo?.administrative || [];
          const lvl4 = admins.find((a) => (a.adminLevel ?? 0) >= 4 && (a.adminLevel ?? 0) < 6)?.name || "";
          let loc = lvl4 || g?.city || g?.locality || g?.principalSubdivision || "";
          loc = String(loc).replace(/市$/, "");
          if (loc) setLocation((v) => v || loc);
          const code = w?.current?.weather_code;
          const temp = w?.current?.temperature_2m;
          const desc = typeof code === "number" ? WMO_ZH[code] : undefined;
          if (desc && typeof temp === "number") setWeather((v) => v || `${desc} ${Math.round(temp)}°C`);
          else if (desc) setWeather((v) => v || desc);
          if (!loc && !desc) setGeoMsg("获取失败，请手动填写");
        }).catch(() => setGeoMsg("获取失败，请手动填写"))
          .finally(() => setGeoBusy(false));
      },
      () => { setGeoBusy(false); setGeoMsg("定位失败，请手动填写"); },
      { timeout: 15000, maximumAge: 600000 },
    );
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { title, content, tags, weather, location, visibility, pinned, archived, allowComments };
      const d = note
        ? await api.put<{ note: NoteInfo }>(`/api/notes/${note.id}`, body)
        : await api.post<{ note: NoteInfo }>("/api/notes", body);
      onSaved(d.note);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>{note ? "编辑独白" : "发表独白"}</h2>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "发布中…" : "发布"}</button>
        </div>
      </div>
      <input className="title-input" value={title} placeholder="标题（可空）" onChange={(e) => setTitle(e.target.value)} />
      <div className="editor-main">
        <div className="editor-pane">
          <div className="editor-tools">
            <div className="seg seg-sm" role="tablist" aria-label="编辑或预览">
              <button className={pane === "edit" ? "on" : ""} onClick={() => setPane("edit")}>编辑</button>
              <button className={pane === "preview" ? "on" : ""} onClick={() => setPane("preview")}>预览</button>
            </div>
            {pane === "edit" && <span className="muted tiny">支持 Markdown</span>}
          </div>
          {pane === "edit" ? (
            <>
              <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式">
                <button type="button" className="md-tool md-tool-bold" title="加粗" onClick={() => wrapSel("**", "**", "加粗文字")}>B</button>
                <button type="button" className="md-tool md-tool-italic" title="斜体" onClick={() => wrapSel("*", "*", "斜体文字")}>I</button>
                <span className="md-tool-wrap" ref={colorWrapRef}>
                  <button type="button" className="md-tool md-tool-color" title="字体颜色" aria-haspopup="true" aria-expanded={colorOpen} onClick={toggleColorPop}>
                    <span className="md-tool-color-a">A</span>
                    <span className="md-tool-color-bar" />
                  </button>
                </span>
                <button type="button" className="md-tool" title="标题" onClick={() => linePrefix("## ")}>H</button>
                <button type="button" className="md-tool" title="链接" onClick={insertLink}>链接</button>
                <button type="button" className="md-tool" title="插入图片（上传）" disabled={uploading}
                  onClick={() => { if (countImages(content) >= 9) { setError("每篇独白最多 9 张图片，已达上限"); return; } fileRef.current?.click(); }}>{uploading ? "上传中…" : "图片"}</button>
                <button type="button" className="md-tool md-tool-mono" title="行内代码" onClick={() => wrapSel("`", "`", "代码")}>{"<>"}</button>
                <button type="button" className="md-tool md-tool-mono" title="代码块" onClick={() => wrapSel("```\n", "\n```", "代码")}>{"{ }"}</button>
                <button type="button" className="md-tool" title="引用" onClick={() => linePrefix("> ")}>引用</button>
                <button type="button" className="md-tool" title="无序列表" onClick={() => linePrefix("- ")}>• 列表</button>
                <button type="button" className="md-tool" title="有序列表" onClick={() => linePrefix("1. ")}>1. 列表</button>
                <button type="button" className="md-tool" title="分割线" onClick={() => insertAt("\n\n---\n\n")}>分割线</button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertImage(f); e.target.value = ""; }} />
              </div>
              {colorOpen && (
                <div className="color-pop" style={{ top: colorPos.top, left: colorPos.left }} role="menu" aria-label="字体颜色">
                  {COLOR_PRESETS.map((c) => (
                    <button key={c} type="button" className="color-dot" style={{ background: c }} title={c} aria-label={`字体颜色 ${c}`} onClick={() => applyColor(c)} />
                  ))}
                  <button type="button" className="color-reset" onClick={() => applyColor(null)}>恢复默认</button>
                </div>
              )}
              <textarea ref={taRef} value={content} placeholder={"在这里写正文，支持 Markdown…\n\n# 标题\n**加粗**、列表、代码块都可以"} onChange={(e) => setContent(e.target.value)} />
            </>
          ) : (
            <div className="markdown swap-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          )}
        </div>
      </div>
      <div className="editor-options">
        <div className="opt">
          <span className="opt-label">标签</span>
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} />
        </div>
        <div className="opt-grid">
          <label className="opt">天气（可选）<input value={weather} placeholder="如 晴 26℃" onChange={(e) => setWeather(e.target.value)} /></label>
          <label className="opt">位置（可选）<input value={location} placeholder="如 重庆" onChange={(e) => setLocation(e.target.value)} /></label>
        </div>
        <div className="opt-geo-row">
          <button type="button" className="text-btn" disabled={geoBusy} onClick={autoFillGeo} aria-label="自动获取天气与位置">
            {geoBusy ? "定位获取中…" : "📍 自动获取"}
          </button>
          {geoMsg && <span className="muted tiny" role="status">{geoMsg}</span>}
        </div>
        <div className="opt-row">
          <span className="opt-label">可见性</span>
          <div className="seg">
            <button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>公开</button>
            <button className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>私密</button>
          </div>
          <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> 置顶</label>
          <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> 归档（不在广场出现）</label>
          <label className="check"><input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} /> 允许评论</label>
        </div>
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
  );
}
