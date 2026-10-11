import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, type CommentInfo, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { Avatar, Lightbox, MoonIcon, NoteCard, PlaneIcon, ShareDialog, SunIcon, imageHit } from "./components";
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

export function HomePage({ user, site, onOpenNote, onComment, q, onSearch, tag, onTag, date, onDate, month, onMonth, days, tags }: {
  user: UserInfo | null; site: SiteInfo; onOpenNote: (n: NoteInfo) => void;
  onComment: (n: NoteInfo) => void;
  q: string; onSearch: (v: string) => void;
  // 标签/日期过滤与日历数据由 App 层持有（抽屉与桌面侧栏共用同一份状态）
  tag: string; onTag: (t: string) => void;
  date: string; onDate: (d: string) => void;
  month: string; onMonth: (m: string) => void;
  days: Record<string, number>; tags: { name: string; count: number }[];
}) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

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

  // 搜索词/标签/日期任一过滤变化时回第一页（含抽屉在非首页设置后带回的过滤）
  useEffect(() => { setPage(1); }, [q, tag, date]);
  useEffect(() => { void load(); }, [load]);

  const [calOpen, setCalOpen] = useState(false);

  return (
    <div className="home-layout">
      <section className="feed">
        {(q || tag) && (
          <div className="feed-tools">
            {q && <button className="chip chip-on" onClick={() => onSearch("")}>搜索「{q}」 ✕</button>}
            {tag && <button className="chip chip-on" onClick={() => onTag("")}>#{tag} ✕</button>}
          </div>
        )}
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
              : site.name ? <span className="brand-badge">{site.name.slice(0, 1)}</span> : <span className="brand-badge brand-badge-blank" aria-hidden="true" />}
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
              <Calendar month={month} days={days} selected={date} onMonth={onMonth} onSelect={onDate} />
            </div>
          </div>
        </div>
        <div className="side-card">
          <h4>标签</h4>
          <div className="tag-row wrap">
            {tags.length === 0 && <span className="muted tiny">暂无标签</span>}
            {tags.map((t) => (
              <button key={t.name} className={`chip${tag === t.name ? " chip-on" : ""}`} onClick={() => onTag(tag === t.name ? "" : t.name)}>
                #{t.name} <em>{t.count}</em>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

// 移动端抽屉（App 层渲染，任何主页面可用；仅 ≤860px 渲染样式，桌面 display:none）：
// 站点卡 + 搜索 + 直展日历 + 标签 + 外观 + 底部登录状态。在非首页点日期/标签/搜索会由
// App 的回调设置过滤并带回首页；已在首页则原地过滤。打开时可靠锁住背景滚动，Esc 关闭。
export function SiteDrawer({ open, onClose, site, user, theme, onToggleTheme, onLogout, onOpenAuth, onHome,
  q, onSearch, onSearchCommit, tags, tag, onPickTag, month, days, date, onMonth, onPickDate }: {
  open: boolean; onClose: () => void;
  site: SiteInfo; user: UserInfo | null;
  theme: "light" | "dark"; onToggleTheme: () => void; onLogout: () => void;
  onOpenAuth: () => void; onHome: () => void;
  q: string; onSearch: (v: string) => void; onSearchCommit: () => void;
  tags: { name: string; count: number }[]; tag: string; onPickTag: (t: string) => void;
  month: string; days: Record<string, number>; date: string;
  onMonth: (m: string) => void; onPickDate: (d: string) => void;
}) {
  const touchX = useRef<number | null>(null);
  // 本次打开期间是否改动过搜索词：关闭（收起类）时若有词且不在首页，带回首页看结果
  const editedRef = useRef(false);
  const dismiss = useCallback(() => {
    if (editedRef.current && q) onSearchCommit();
    onClose();
  }, [q, onClose, onSearchCommit]);
  const dismissRef = useRef(dismiss);
  useEffect(() => { dismissRef.current = dismiss; });
  useEffect(() => { if (open) editedRef.current = false; }, [open ]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismissRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);
  useEffect(() => {
    if (!open) return;
    // iOS 上仅 body overflow:hidden 挡不住背景滚动、面板高度还会随动态工具栏变化被拉伸，
    // 改用 position:fixed 锁定 body（记录并保持当前滚动位置），关闭时精确恢复。
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position, top: body.style.top, left: body.style.left,
      right: body.style.right, width: body.style.width, overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open ]);

  return (
    <div className={`drawer-root${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={dismiss} />
      <aside className="drawer" aria-label="站点导航"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current !== null && e.changedTouches[0].clientX - touchX.current < -56) dismiss();
          touchX.current = null;
        }}>
        <button type="button" className="drawer-site" onClick={() => { onHome(); onClose(); window.scrollTo(0, 0); }}>
          {site.logo
            ? <img src={site.logo} alt="" className="brand-logo" />
            : site.name ? <span className="brand-badge">{site.name.slice(0, 1)}</span> : <span className="brand-badge brand-badge-blank" aria-hidden="true" />}
          <span className="brand-name">{site.name}</span>
          {site.subtitle && <span className="brand-sub">{site.subtitle}</span>}
        </button>
        <div className="drawer-sec">
          <div className="drawer-search">
            <input value={q} placeholder="搜索标题或正文…" aria-label="搜索标题或正文"
              onChange={(e) => { editedRef.current = true; onSearch(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter") dismiss(); }} />
            {q && <button type="button" className="icon-btn search-clear" aria-label="清除搜索" onClick={() => onSearch("")}>✕</button>}
          </div>
        </div>
        <div className="drawer-sec">
          <h5>日历归档</h5>
          <Calendar month={month} days={days} selected={date} onMonth={onMonth} onSelect={onPickDate} />
        </div>
        <div className="drawer-sec">
          <h5>标签</h5>
          <div className="tag-row wrap">
            {tags.length === 0 && <span className="muted tiny">暂无标签</span>}
            {tags.map((t) => (
              <button key={t.name} className={`chip${tag === t.name ? " chip-on" : ""}`}
                onClick={() => onPickTag(tag === t.name ? "" : t.name)}>
                #{t.name} <em>{t.count}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-sec">
          <button type="button" className="drawer-nav-item" onClick={onToggleTheme}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span>外观</span>
            <span className="muted tiny drawer-nav-right">{theme === "dark" ? "夜晚" : "白天"}</span>
          </button>
        </div>
        <div className="drawer-foot">
          {user ? (
            <div className="drawer-user-row">
              <a className="drawer-user-link" href="#me" onClick={onClose} aria-label="进入用户中心">
                <Avatar url={user.avatar} name={user.nickname} size={40} />
                <span className="drawer-user-meta">
                  <strong>{user.nickname}</strong>
                  <span className="muted tiny">@{user.username}</span>
                </span>
              </a>
              <button type="button" className="drawer-logout" onClick={() => { onClose(); onLogout(); }}>退出登录</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={() => { onClose(); onOpenAuth(); }}>登录 / 注册</button>
          )}
        </div>
      </aside>
    </div>
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
    api.get<{ note: NoteInfo }>(`/api/notes/${noteId}?view=1`).then((d) => setNote(d.note)).catch((e) => setError((e as Error).message));
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
        <button type="button" className="act-btn" aria-label="分享" title="分享" onClick={() => setShareOpen(true)}><PlaneIcon /></button>
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
