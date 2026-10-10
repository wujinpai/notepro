import { useCallback, useEffect, useRef, useState } from "react";
import { api, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { AuthDialog, Avatar, MoonIcon, PenIcon, SearchIcon, SunIcon } from "./components";
import { HomePage, NoteDetail } from "./pages-home";
import { SharePage } from "./pages-share";
import { EditorPage } from "./pages-editor";
import { MePage } from "./pages-me";
import { AdminPage } from "./pages-admin";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("np-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!localStorage.getItem("np-theme")) setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem("np-theme", next);
    setTheme(next);
  };
  return { theme, toggle };
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [site, setSite] = useState<SiteInfo>({ name: "己素", subtitle: "Jisu", description: "", keywords: "", footer: "", icp: "", logo: "", registerOpen: true, oauthProviders: [] });
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState(location.hash);
  const [editNote, setEditNote] = useState<NoteInfo | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 搜索词提升到顶层：顶栏弹出条（桌面）与抽屉搜索框（移动端）共用同一状态
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // 游客在信息流点「评论」先登录，登录成功后自动续跳到该篇详情评论区
  const [pendingComment, setPendingComment] = useState<number | null>(null);
  const [commentFocus, setCommentFocus] = useState<number | null>(null);

  const refreshUser = useCallback(() => {
    api.get<{ user: UserInfo }>("/api/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    api.get<SiteInfo>("/api/site").then((d) => {
      setSite(d);
      document.title = d.subtitle ? `${d.name} - ${d.subtitle}` : d.name;
      const meta = document.querySelector('meta[name="description"]');
      if (meta && d.description) meta.setAttribute("content", d.description);
    }).catch(() => undefined);
    refreshUser();
    // OAuth 回调带回的消息/成功标记
    const params = new URLSearchParams(location.search);
    if (params.get("oauth") === "ok") { history.replaceState(null, "", location.pathname + location.hash); refreshUser(); }
    if (params.get("oauth_msg")) { alert(params.get("oauth_msg")); history.replaceState(null, "", location.pathname + location.hash); }
  }, [refreshUser]);

  useEffect(() => {
    const onHash = () => { setRoute(location.hash); setMenuOpen(false); setDrawerOpen(false); setSearchOpen(false); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 搜索条展开时自动聚焦；Esc 收起（过滤词保留，图标亮起表示仍在过滤）
  useEffect(() => {
    if (!searchOpen) return;
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSearchOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // 头像菜单：点外部 / Esc 关闭（仅作用于该菜单）
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const go = (h: string) => { location.hash = h; };
  const openNote = (n: NoteInfo) => go(`#note/${n.id}`);
  const openEdit = (n: NoteInfo | null) => {
    if (!user) { setAuthOpen(true); return; }
    setEditNote(n); setEditLoaded(true);
    go(n ? `#edit/${n.id}` : "#edit");
  };

  // 直接通过 #edit/<id> 进入时拉取笔记
  useEffect(() => {
    const m = route.match(/^#edit\/(\d+)$/);
    if (m && (!editNote || editNote.id !== Number(m[1]))) {
      setEditLoaded(false);
      api.get<{ note: NoteInfo }>(`/api/notes/${m[1]}`)
        .then((d) => { setEditNote(d.note); setEditLoaded(true); })
        .catch(() => { setEditNote(null); setEditLoaded(true); });
    }
    if (route === "#edit") { setEditNote(null); setEditLoaded(true); }
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null); go("#");
  };

  const noteId = route.match(/^#note\/(\d+)$/)?.[1];
  const isEdit = route === "#edit" || /^#edit\/\d+$/.test(route);
  const isMe = route.startsWith("#me");
  const isAdmin = route.startsWith("#admin");
  const isHome = !noteId && !isEdit && !isMe && !isAdmin;

  // 信息流「评论」：已登录直达详情评论区；游客先弹登录框，登录后自动续跳
  const openComment = (n: NoteInfo) => {
    if (!user) { setPendingComment(n.id); setAuthOpen(true); return; }
    setCommentFocus(n.id);
    go(`#note/${n.id}`);
  };
  const openDrawer = () => {
    if (!isHome) go("#");
    setDrawerOpen(true);
  };
  const toggleSearch = () => {
    if (!isHome) go("#");
    setSearchOpen((s) => !s);
  };
  const onAuthed = (u: UserInfo) => {
    setUser(u);
    if (pendingComment) {
      const id = pendingComment;
      setPendingComment(null);
      setCommentFocus(id);
      go(`#note/${id}`);
    }
  };

  // 独立分享页是真实路径 /s/<token>，不走哈希路由与应用顶栏
  const shareMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,})$/);
  if (shareMatch) return <SharePage token={shareMatch[1]} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={openDrawer} aria-label="打开菜单"><MenuIcon /></button>
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go("#"); }}>
          {site.logo ? <img src={site.logo} alt="" className="brand-logo" /> : <span className="brand-badge">N</span>}
          <span className="brand-name">{site.name}</span>
          {site.subtitle && <span className="brand-sub">{site.subtitle}</span>}
        </a>
        <nav className="top-actions">
          <button className={`icon-btn search-btn${q ? " on" : ""}`} onClick={toggleSearch} aria-label="搜索" title="搜索" aria-expanded={searchOpen}><SearchIcon /></button>
          <button className="icon-btn theme-btn" onClick={toggle} title={theme === "dark" ? "切换到白天" : "切换到夜晚"} aria-label="切换主题">{theme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
          {user ? (
            <>
              <button className="icon-btn pen-btn" onClick={() => openEdit(null)} aria-label="写独白" title="写独白"><PenIcon /></button>
              <button className="btn btn-primary compose-btn" onClick={() => openEdit(null)}>独白</button>
              <div className="user-menu-wrap" ref={menuRef}>
                <button className="user-chip" onClick={() => setMenuOpen(!menuOpen)}>
                  <Avatar url={user.avatar} name={user.nickname} size={30} />
                  <span>{user.nickname}</span>
                </button>
                {menuOpen && (
                  <div className="user-menu">
                    <button onClick={() => { setMenuOpen(false); go("#me"); }}>用户中心</button>
                    <button onClick={() => { setMenuOpen(false); go("#me/notes"); }}>我的笔记</button>
                    {user.role === "admin" && <button onClick={() => { setMenuOpen(false); go("#admin"); }}>管理后台</button>}
                    <button onClick={() => { setMenuOpen(false); void logout(); }}>退出登录</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-ghost guest-btn" onClick={() => setAuthOpen(true)}>登录</button>
              {site.registerOpen && <button className="btn btn-primary guest-btn" onClick={() => setAuthOpen(true)}>注册</button>}
            </>
          )}
        </nav>
        {searchOpen && (
          <div className="search-bar">
            <span className="search-bar-ic"><SearchIcon /></span>
            <input ref={searchRef} value={q} placeholder="搜索标题或正文…" aria-label="搜索标题或正文"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }} />
            {q && <button type="button" className="icon-btn search-clear" aria-label="清除搜索" onClick={() => setQ("")}>✕</button>}
          </div>
        )}
      </header>

      <main className="container">
        {isAdmin ? (
          user?.role === "admin" ? <AdminPage user={user} /> : <div className="empty">需要管理员权限。</div>
        ) : isMe ? (
          user ? <MePage user={user} site={site} refreshUser={refreshUser} onEditNote={openEdit} onOpenNote={openNote} /> : <div className="empty">请先登录。<button className="text-btn" onClick={() => setAuthOpen(true)}>去登录</button></div>
        ) : isEdit ? (
          !user ? <div className="empty">请先登录。</div>
            : !editLoaded ? <div className="empty">加载中…</div>
            : <EditorPage key={editNote?.id || "new"} note={editNote} onCancel={() => go("#")} onSaved={(n) => go(`#note/${n.id}`)} />
        ) : noteId ? (
          <NoteDetail noteId={Number(noteId)} user={user} onBack={() => go("#")} onEdit={openEdit} onDeleted={() => go("#")}
            focusComments={commentFocus === Number(noteId)} onAuthRequest={() => setAuthOpen(true)} />
        ) : (
          <HomePage user={user} site={site} onOpenNote={openNote} onComment={openComment}
            q={q} onSearch={setQ} theme={theme} onToggleTheme={toggle} onLogout={() => void logout()}
            drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} onOpenAuth={() => setAuthOpen(true)} />
        )}
      </main>

      <footer className="site-footer">
        <span>{site.name}{site.subtitle ? ` · ${site.subtitle}` : ""}</span>
        {site.footer && <span>{site.footer}</span>}
        {site.icp && <a className="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.icp}</a>}
      </footer>

      {authOpen && (
        <AuthDialog site={site}
          onClose={() => { setAuthOpen(false); setPendingComment(null); }}
          onAuthed={onAuthed} />
      )}
    </div>
  );
}
