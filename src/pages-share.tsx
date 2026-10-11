import { useEffect, useState } from "react";
import { api, bootSite, cacheSite, applyAccent, fmtTime, type NoteInfo, type SiteInfo } from "./api";
import { Avatar, Lightbox, imageHit } from "./components";
import { renderMarkdown } from "./md";

// 独立分享页（/s/<token> 真实路径）与公开独白只读页（/n/<id>）：极简品牌行 + 笔记正文 + 页脚备案，无任何作者控件
export function SharePage({ token, noteId }: { token?: string; noteId?: number }) {
  // 初始站点信息与主应用同口径：服务端注入/本地缓存，未就绪时品牌区只占位，不闪蓝 N 与默认名
  const [site, setSite] = useState<SiteInfo | null>(() => {
    const s = bootSite();
    if (s?.accent) applyAccent(s.accent);
    return s;
  });
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "bad">("loading");
  const [lb, setLb] = useState<{ images: string[]; index: number } | null>(null);
  const fetchUrl = token ? `/api/share/${token}?view=1` : `/api/public/notes/${noteId}?view=1`;

  useEffect(() => {
    api.get<SiteInfo>("/api/site").then((d) => { setSite(d); cacheSite(d); if (d.accent) applyAccent(d.accent); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    let dead = false;
    api.get<{ note: NoteInfo }>(fetchUrl)
      .then((d) => { if (!dead) { setNote(d.note); setState("ok"); } })
      .catch(() => { if (!dead) setState("bad"); });
    return () => { dead = true; };
  }, [fetchUrl]);
  useEffect(() => {
    if (note) document.title = `${note.title || (token ? "分享独白" : "独白")}${site ? ` - ${site.name}` : ""}`;
  }, [note, site, token]);

  return (
    <div className="app share-page">
      <a className="share-brand" href="/">
        {site?.logo
          ? <img src={site.logo} alt="" className="brand-logo" />
          : site?.name ? <span className="brand-badge">{site.name.slice(0, 1)}</span> : <span className="brand-badge brand-badge-blank" aria-hidden="true" />}
        <span className="brand-name">{site?.name || ""}</span>
        {site?.subtitle && <span className="brand-sub">{site.subtitle}</span>}
      </a>

      <main className="share-main">
        {state === "loading" && <div className="empty">加载中…</div>}
        {state === "bad" && (
          <div className="share-card">
            <div className="empty">
              链接不存在或已失效。
              <div className="share-home-row">
                <a className="btn btn-primary" href="/">回首页</a>
              </div>
            </div>
          </div>
        )}
        {state === "ok" && note && (
          <>
            <article className="share-card">
              <div className="share-author">
                {note.author && <Avatar url={note.author.avatar} name={note.author.nickname} size={38} />}
                <div className="note-meta">
                  <strong>{note.author?.nickname || "用户"}</strong>
                  <span className="muted tiny">@{note.author?.username} · {fmtTime(note.createdAt)}</span>
                </div>
                {note.pinned && <span className="badge badge-pin">置顶</span>}
              </div>
              {note.title && <h1>{note.title}</h1>}
              {(note.weather || note.location) && (
                <div className="note-env">
                  {note.weather && <span>🌤 {note.weather}</span>}
                  {note.location && <span>📍 {note.location}</span>}
                </div>
              )}
              <div className="markdown"
                onClick={(e) => { const hit = imageHit(e); if (hit) setLb(hit); }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
              {note.tags.length > 0 && (
                <div className="tag-row">{note.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div>
              )}
            </article>
            <div className="share-home-row">
              <a className="btn btn-ghost" href="/">回首页看更多</a>
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>{site?.name || ""}{site?.subtitle ? ` · ${site.subtitle}` : ""}</span>
        {site?.footer && <span>{site.footer}</span>}
        {site?.icp && (
          <a className="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.icp}</a>
        )}
      </footer>

      {lb && <Lightbox images={lb.images} index={lb.index} onClose={() => setLb(null)} />}
    </div>
  );
}
