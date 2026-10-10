import { useEffect, useRef, useState } from "react";
import { api, type NoteInfo } from "./api";
import { TagInput } from "./components";
import { countImages, renderMarkdown } from "./md";

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { title, content, tags, weather, location, visibility, pinned, archived };
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
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
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
        <div className="opt-row">
          <span className="opt-label">可见性</span>
          <div className="seg">
            <button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>公开</button>
            <button className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>私密</button>
          </div>
          <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> 置顶</label>
          <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> 归档（不在广场出现）</label>
        </div>
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
  );
}
