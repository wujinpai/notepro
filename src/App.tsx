import { useCallback, useEffect, useRef, useState } from "react";
import { api, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { AuthDialog, Avatar } from "./components";
import { HomePage, NoteDetail } from "./pages-home";
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

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2.6" x2="12" y2="5.1" />
        <line x1="12" y1="18.9" x2="12" y2="21.4" />
        <line x1="2.6" y1="12" x2="5.1" y2="12" />
        <line x1="18.9" y1="12" x2="21.4" y2="12" />
        <line x1="5.2" y1="5.2" x2="7" y2="7" />
        <line x1="17" y1="17" x2="18.8" y2="18.8" />
        <line x1="18.8" y1="5.2" x2="17" y2="7" />
        <line x1="7" y1="17" x2="5.2" y2="18.8" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
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
    const onHash = () => { setRoute(location.hash); setMenuOpen(false); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go("#"); }}>
          {site.logo ? <img src={site.logo} alt="" className="brand-logo" /> : <span className="brand-badge">N</span>}
          <span className="brand-name">{site.name}</span>
          {site.subtitle && <span className="brand-sub">{site.subtitle}</span>}
        </a>
        <nav className="top-actions">
          <button className="icon-btn" onClick={toggle} title={theme === "dark" ? "切换到白天" : "切换到夜晚"} aria-label="切换主题">{theme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
          {user ? (
            <>
              <button className="btn btn-primary" onClick={() => openEdit(null)}>独白</button>
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
              <button className="btn btn-ghost" onClick={() => setAuthOpen(true)}>登录</button>
              {site.registerOpen && <button className="btn btn-primary" onClick={() => setAuthOpen(true)}>注册</button>}
            </>
          )}
        </nav>
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
          <NoteDetail noteId={Number(noteId)} user={user} onBack={() => go("#")} onEdit={openEdit} onDeleted={() => go("#")} />
        ) : (
          <HomePage user={user} onOpenNote={openNote} />
        )}
      </main>

      <footer className="site-footer">
        <span>{site.name}{site.subtitle ? ` · ${site.subtitle}` : ""}</span>
        {site.footer && <span>{site.footer}</span>}
        {site.icp && <a className="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.icp}</a>}
      </footer>

      {authOpen && <AuthDialog site={site} onClose={() => setAuthOpen(false)} onAuthed={(u) => { setUser(u); }} />}
    </div>
  );
}
