import { useEffect, useRef, useState } from "react";
import { api, type NoteInfo } from "./api";
import { TagInput } from "./components";
import { renderMarkdown } from "./md";

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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ tags: { name: string }[] }>("/api/tags?mine=1").then((d) => setSuggestions(d.tags.map((t) => t.name))).catch(() => undefined);
  }, []);

  const insertImage = async (file: File) => {
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
        <h2>{note ? "编辑笔记" : "写笔记"}</h2>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
        </div>
      </div>
      <input className="title-input" value={title} placeholder="标题（可空）" onChange={(e) => setTitle(e.target.value)} />
      <div className="editor-main">
        <div className="editor-pane">
          <div className="editor-tools">
            <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "上传中…" : "插入图片"}</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertImage(f); e.target.value = ""; }} />
            <span className="muted tiny">支持 Markdown</span>
          </div>
          <textarea ref={taRef} value={content} placeholder={"在这里写正文，支持 Markdown…\n\n# 标题\n**加粗**、列表、代码块都可以"} onChange={(e) => setContent(e.target.value)} />
        </div>
        <div className="editor-pane preview-pane">
          <div className="editor-tools"><span className="muted tiny">实时预览</span></div>
          <div className="markdown preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
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
