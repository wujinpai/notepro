import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, type CommentInfo, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { Avatar, Lightbox, NoteCard, ShareDialog, imageHit } from "./components";
import { renderMarkdown } from "./md";

export function Calendar({ month, days, selected, onMonth, onSelect }: {
  month: string; days: Record<string, number>; selected: string;
  onMonth: (m: string) => void; onSelect: (d: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDay = (first.getDay() + 6) % 7; // 周一为首列
  const count = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="上个月">‹</button>
        <strong>{y} 年 {m} 月</strong>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="下个月">›</button>
      </div>
      <div className="calendar-grid cal-dow"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div className="calendar-grid">
        {cells.map((d, i) => d === null
          ? <span key={`e${i}`} />
          : (
            <button key={d} className={`cal-day${d === selected ? " on" : ""}${d === today ? " today" : ""}`} onClick={() => onSelect(d === selected ? "" : d)}>
              {Number(d.slice(8))}
              {days[d] ? <em>{days[d]}</em> : null}
            </button>
          ))}
      </div>
      {selected && <button className="text-btn" onClick={() => onSelect("")}>清除日期过滤（{selected}）</button>}
    </div>
  );
}

export function HomePage({ user, site, onOpenNote, onComment, drawerOpen, onCloseDrawer, onOpenAuth }: {
  user: UserInfo | null; site: SiteInfo; onOpenNote: (n: NoteInfo) => void;
  onComment: (n: NoteInfo) => void;
  drawerOpen: boolean; onCloseDrawer: () => void; onOpenAuth: () => void;
}) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [days, setDays] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), size: "20" });
    if (tag) params.set("tag", tag);
    if (q) params.set("q", q);
    if (date) params.set("date", date);
    try {
      const d = await api.get<{ notes: NoteInfo[]; total: number }>(`/api/notes?${params}`);
      setNotes(d.notes); setTotal(d.total);
    } catch { setNotes([]); setTotal(0); }
  }, [page, tag, q, date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api.get<{ tags: { name: string; count: number }[] }>("/api/tags").then((d) => setTags(d.tags)).catch(() => setTags([]));
    api.get<{ days: Record<string, number> }>(`/api/calendar?month=${month}`).then((d) => setDays(d.days)).catch(() => setDays({}));
  }, [month, user]);

  const [calOpen, setCalOpen] = useState(false);

  // 移动端抽屉：打开时锁滚动，Esc 关闭
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseDrawer(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
    <div className="home-layout">
      <section className="feed">
        <div className="feed-tools">
          <input className="search" value={q} placeholder="搜索标题或正文…" onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          {tag && <button className="chip chip-on" onClick={() => setTag("")}>#{tag} ✕</button>}
        </div>
        {notes.length === 0 && <div className="empty">暂无笔记{user ? "，点击右上角「独白」发布第一篇" : ""}。</div>}
        {notes.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpenNote} onComment={onComment} />)}
        {total > 20 && (
          <div className="pager">
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span className="muted">{page} / {Math.ceil(total / 20)}</span>
            <button className="btn btn-ghost" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        )}
      </section>
      <aside className="side">
        {user ? (
          <a className="side-card side-user" href="#me">
            <Avatar url={user.avatar} name={user.nickname} size={46} />
            <span className="side-user-meta">
              <strong>{user.nickname}</strong>
              <span className="muted tiny">@{user.username}</span>
            </span>
          </a>
        ) : (
          <div className="side-card side-user">
            {site.logo
              ? <img src={site.logo} alt="" className="brand-logo" />
              : <span className="brand-badge">{(site.name || "N").slice(0, 1)}</span>}
            <span className="side-user-meta">
              <strong>{site.name}</strong>
              <span className="muted tiny">{site.subtitle || site.description || "多用户笔记广场"}</span>
            </span>
          </div>
        )}
        <div className="side-card cal-card">
          <button type="button" className="cal-toggle" aria-expanded={calOpen} onClick={() => setCalOpen(!calOpen)}>
            <span className="cal-toggle-title">日历归档</span>
            {date && <span className="muted tiny">{date}</span>}
            <svg className={`cal-chevron${calOpen ? " open" : ""}`} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className={`cal-collapse${calOpen ? " open" : ""}`}>
            <div className="cal-collapse-inner">
              <Calendar month={month} days={days} selected={date} onMonth={setMonth} onSelect={(d) => { setDate(d); setPage(1); }} />
            </div>
          </div>
        </div>
        <div className="side-card">
          <h4>标签</h4>
          <div className="tag-row wrap">
            {tags.length === 0 && <span className="muted tiny">暂无标签</span>}
            {tags.map((t) => (
              <button key={t.name} className={`chip${tag === t.name ? " chip-on" : ""}`} onClick={() => { setTag(tag === t.name ? "" : t.name); setPage(1); }}>
                #{t.name} <em>{t.count}</em>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>

    {/* 移动端抽屉（仅 ≤860px 渲染样式，桌面 display:none）：站点卡 + 直展日历 + 标签 + 底部登录状态 */}
    <div className={`drawer-root${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
      <div className="drawer-backdrop" onClick={onCloseDrawer} />
      <aside className="drawer" aria-label="站点导航"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current !== null && e.changedTouches[0].clientX - touchX.current < -56) onCloseDrawer();
          touchX.current = null;
        }}>
        <button type="button" className="drawer-site" onClick={() => { onCloseDrawer(); window.scrollTo(0, 0); }}>
          {site.logo
            ? <img src={site.logo} alt="" className="brand-logo" />
            : <span className="brand-badge">{(site.name || "N").slice(0, 1)}</span>}
          <span className="brand-name">{site.name}</span>
          {site.subtitle && <span className="brand-sub">{site.subtitle}</span>}
        </button>
        <div className="drawer-sec">
          <h5>日历归档</h5>
          <Calendar month={month} days={days} selected={date} onMonth={setMonth}
            onSelect={(d) => { setDate(d); setPage(1); onCloseDrawer(); }} />
        </div>
        <div className="drawer-sec">
          <h5>标签</h5>
          <div className="tag-row wrap">
            {tags.length === 0 && <span className="muted tiny">暂无标签</span>}
            {tags.map((t) => (
              <button key={t.name} className={`chip${tag === t.name ? " chip-on" : ""}`}
                onClick={() => { setTag(tag === t.name ? "" : t.name); setPage(1); onCloseDrawer(); }}>
                #{t.name} <em>{t.count}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-foot">
          {user ? (
            <a className="drawer-user" href="#me" onClick={onCloseDrawer}>
              <Avatar url={user.avatar} name={user.nickname} size={40} />
              <span className="drawer-user-meta">
                <strong>{user.nickname}</strong>
                <span className="muted tiny">@{user.username}</span>
              </span>
              <span className="muted tiny">用户中心 ›</span>
            </a>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={() => { onCloseDrawer(); onOpenAuth(); }}>登录 / 注册</button>
          )}
        </div>
      </aside>
    </div>
    </>
  );
}

export function NoteDetail({ noteId, user, onBack, onEdit, onDeleted, focusComments, onAuthRequest }: {
  noteId: number; user: UserInfo | null; onBack: () => void;
  onEdit: (n: NoteInfo) => void; onDeleted: () => void;
  focusComments: boolean; onAuthRequest: () => void;
}) {
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [error, setError] = useState("");
  const [lb, setLb] = useState<{ images: string[]; index: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    api.get<{ note: NoteInfo }>(`/api/notes/${noteId}`).then((d) => setNote(d.note)).catch((e) => setError((e as Error).message));
  }, [noteId]);
  if (error) return <div className="empty">{error}。<button className="text-btn" onClick={onBack}>返回</button></div>;
  if (!note) return <div className="empty">加载中…</div>;
  const mine = user && (user.id === note.userId || user.role === "admin");
  const del = async () => {
    if (!confirm("确定删除这篇笔记？")) return;
    await api.del(`/api/notes/${note.id}`);
    onDeleted();
  };
  return (
    <article className="note-detail">
      <button className="text-btn" onClick={onBack}>← 返回列表</button>
      {note.title && <h1>{note.title}</h1>}
      <div className="note-meta-line muted">
        {note.author?.nickname} · {new Date(note.createdAt).toLocaleString("zh-CN")}
        {note.weather && <span> · 🌤 {note.weather}</span>}
        {note.location && <span> · 📍 {note.location}</span>}
        {note.pinned && <span className="badge badge-pin">置顶</span>}
        {note.visibility === "private" && <span className="badge">私密</span>}
        {note.archived && <span className="badge">归档</span>}
      </div>
      <div className="markdown" onClick={(e) => { const hit = imageHit(e); if (hit) setLb(hit); }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
      {lb && <Lightbox images={lb.images} index={lb.index} onClose={() => setLb(null)} />}
      {note.tags.length > 0 && <div className="tag-row">{note.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div>}
      <div className="row-gap">
        <button className="btn btn-ghost" onClick={() => setShareOpen(true)}>分享</button>
        {mine && user!.id === note.userId && <button className="btn btn-ghost" onClick={() => onEdit(note)}>编辑</button>}
        {mine && <button className="btn btn-danger" onClick={() => void del()}>删除</button>}
      </div>
      {shareOpen && <ShareDialog note={note} onClose={() => setShareOpen(false)} />}
      <CommentsSection note={note} user={user} focus={focusComments} onAuthRequest={onAuthRequest} />
    </article>
  );
}

// ---------- 评论区 ----------
function CommentsSection({ note, user, focus, onAuthRequest }: {
  note: NoteInfo; user: UserInfo | null; focus: boolean; onAuthRequest: () => void;
}) {
  const [comments, setComments] = useState<CommentInfo[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef<HTMLElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ comments: CommentInfo[] }>(`/api/notes/${note.id}/comments`);
      setComments(d.comments);
    } catch { setComments([]); } finally { setLoaded(true); }
  }, [note.id]);
  useEffect(() => { void load(); }, [load]);

  // 从信息流「评论」进来：滚到评论区，登录用户直接聚焦输入框
  useEffect(() => {
    if (!focus || !loaded || !note.allowComments) return;
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (user) setTimeout(() => taRef.current?.focus({ preventScroll: true }), 380);
  }, [focus, loaded, note.allowComments, user]);

  const submit = async () => {
    const content = text.trim();
    if (!content) return;
    setBusy(true); setErr("");
    try {
      const d = await api.post<{ comment: CommentInfo }>(`/api/notes/${note.id}/comments`, { content });
      setComments((cs) => [...cs, d.comment]);
      setText("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (c: CommentInfo) => {
    if (!confirm("确定删除这条评论？")) return;
    try { await api.del(`/api/comments/${c.id}`); setComments((cs) => cs.filter((x) => x.id !== c.id)); }
    catch (e) { setErr((e as Error).message); }
  };
  const canDel = (c: CommentInfo) => !!user && (user.id === c.userId || user.id === note.userId || user.role === "admin");

  return (
    <section className="comments" ref={boxRef} aria-label="评论区">
      <h4>评论{note.allowComments && comments.length > 0 ? ` · ${comments.length}` : ""}</h4>
      {!note.allowComments ? (
        <p className="muted">作者已关闭评论</p>
      ) : (
        <>
          {user ? (
            <div className="comment-form">
              <textarea ref={taRef} value={text} rows={3} maxLength={500} placeholder="写下你的评论…"
                onChange={(e) => setText(e.target.value)} />
              <div className="comment-form-row">
                <span className="muted tiny">{text.length}/500</span>
                {err && <span className="err-text">{err}</span>}
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void submit()}>
                  {busy ? "发表中…" : "发表评论"}
                </button>
              </div>
            </div>
          ) : (
            <div className="comment-login-hint">
              <span className="muted">登录后发表评论</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onAuthRequest}>登录</button>
            </div>
          )}
          <div className="comment-list">
            {loaded && comments.length === 0 && <p className="muted tiny">还没有评论，来坐第一个。</p>}
            {comments.map((c) => (
              <div key={c.id} className="comment-item">
                <Avatar url={c.author?.avatar || ""} name={c.author?.nickname || "?"} size={30} />
                <div className="comment-main">
                  <div className="comment-head">
                    <strong>{c.author?.nickname || "用户"}</strong>
                    <span className="muted tiny">{fmtTime(c.createdAt)}</span>
                    {canDel(c) && <button type="button" className="text-btn comment-del" onClick={() => void del(c)}>删除</button>}
                  </div>
                  <p className="comment-body">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
