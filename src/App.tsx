import { useCallback, useEffect, useRef, useState } from "react";
import { api, bootSite, cacheSite, syncFavicon, applyAccent, DEFAULT_ICON, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { AuthDialog, Avatar, GithubIcon, MoonIcon, PenIcon, SearchIcon, SunIcon } from "./components";
import { HomePage, NoteDetail, SiteDrawer } from "./pages-home";
import { SharePage } from "./pages-share";
import { EditorPage } from "./pages-editor";
import { MePage } from "./pages-me";

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

// ---- 首页滚动位置存档：离开首页时按筛选 key 存 scrollY，返回时恢复 ----
// 模块变量 + sessionStorage 双存（刷新页面后返回也能恢复）
const HOME_SCROLL_KEY = "notepro:home-scroll";
let homeScrollMem: { key: string; y: number } | null = null;
function saveHomeScroll(key: string, y: number) {
  homeScrollMem = { key, y };
  try { sessionStorage.setItem(HOME_SCROLL_KEY, JSON.stringify(homeScrollMem)); } catch { /* ignore */ }
}
function readHomeScroll(key: string): number | null {
  if (homeScrollMem && homeScrollMem.key === key) return homeScrollMem.y;
  try {
    const raw = sessionStorage.getItem(HOME_SCROLL_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { key: string; y: number };
      if (d && d.key === key && typeof d.y === "number") { homeScrollMem = d; return d.y; }
    }
  } catch { /* ignore */ }
  return null;
}
function clearHomeScroll() {
  homeScrollMem = null;
  try { sessionStorage.removeItem(HOME_SCROLL_KEY); } catch { /* ignore */ }
}
function hashIsHome(h: string): boolean {
  return !/^#note\/\d+$/.test(h) && h !== "#edit" && !/^#edit\/\d+$/.test(h) && !h.startsWith("#me") && !h.startsWith("#admin");
}

export default function App() {
  const { theme, toggle } = useTheme();
  // 初始站点信息来自服务端注入/本地缓存，未就绪时 name 留空：品牌区只渲染中性占位，不闪默认「己素」与蓝 N
  const [site, setSite] = useState<SiteInfo>(() => {
    const s = bootSite() ?? { name: "", subtitle: "", description: "", keywords: "", footer: "", icp: "", logo: "", accent: "", registerOpen: true, oauthProviders: [] };
    if (s.accent) applyAccent(s.accent);
    return s;
  });
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState(location.hash);
  const [editNote, setEditNote] = useState<NoteInfo | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 搜索词与标签/日期过滤、日历/标签数据都提升到 App 层：抽屉（已全局化）与首页信息流/桌面侧栏共用同一份状态
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  // 过滤变化（搜索/标签/日期）：清掉首页滚动存档并回到顶部
  const setQf = (v: string) => { setQ(v); clearHomeScroll(); window.scrollTo(0, 0); };
  const setTagFilterf = (t: string) => { setTagFilter(t); clearHomeScroll(); window.scrollTo(0, 0); };
  const setDateFilterf = (d: string) => { setDateFilter(d); clearHomeScroll(); window.scrollTo(0, 0); };
  // 返回首页时的滚动恢复：路由切换处设置，HomePage 列表渲染后通过 onListSettled 消费
  const isHomeRef = useRef(hashIsHome(location.hash));
  const filterKeyRef = useRef("");
  const pendingRestoreRef = useRef<number | null>(null);
  filterKeyRef.current = `${tagFilter}|${q}|${dateFilter}`;
  const handleListSettled = useCallback(() => {
    const y = pendingRestoreRef.current;
    if (y == null) return;
    pendingRestoreRef.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => { window.scrollTo(0, y); }));
  }, []);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; });
  const [calDays, setCalDays] = useState<Record<string, number>>({});
  const [allTags, setAllTags] = useState<{ name: string; count: number }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // 游客在信息流点「评论」先登录，登录成功后自动续跳到该篇详情评论区
  const [pendingComment, setPendingComment] = useState<number | null>(null);
  const [commentFocus, setCommentFocus] = useState<number | null>(null);

  const refreshUser = useCallback(() => {
    api.get<{ user: UserInfo }>("/api/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  // 日历/标签导航数据：挂载、切月、登录态变化时加载，抽屉每次打开再刷新一次（各页面共用，避免重复请求风暴）
  const loadNav = useCallback(() => {
    api.get<{ tags: { name: string; count: number }[] }>("/api/tags").then((d) => setAllTags(d.tags)).catch(() => setAllTags([]));
    api.get<{ days: Record<string, number> }>(`/api/calendar?month=${calMonth}`).then((d) => setCalDays(d.days)).catch(() => setCalDays({}));
  }, [calMonth]);
  useEffect(() => { loadNav(); }, [loadNav, user]);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen && !drawerWasOpen.current) loadNav();
    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen, loadNav]);

  useEffect(() => {
    api.get<SiteInfo>("/api/site").then((d) => {
      setSite(d);
      cacheSite(d);
      if (d.accent) applyAccent(d.accent);
      syncFavicon(d.logo || DEFAULT_ICON);
      document.title = d.subtitle ? `${d.name} - ${d.subtitle}` : d.name;
      const meta = document.querySelector('meta[name="description"]');
      if (meta && d.description) meta.setAttribute("content", d.description);
    }).catch(() => {
      // 接口异常时才落默认品牌（正常路径首帧已由注入/缓存给出真值，不会闪）
      setSite((s) => (s.name ? s : { name: "己素", subtitle: "Jisu", description: "", keywords: "", footer: "", icp: "", logo: "", accent: "", registerOpen: true, oauthProviders: [] }));
    });
    refreshUser();
    // OAuth 回调带回的消息/成功标记
    const params = new URLSearchParams(location.search);
    if (params.get("oauth") === "ok") { history.replaceState(null, "", location.pathname + location.hash); refreshUser(); }
    if (params.get("oauth_msg")) { alert(params.get("oauth_msg")); history.replaceState(null, "", location.pathname + location.hash); }
  }, [refreshUser]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash;
      // 离开首页：按当前筛选 key 存档滚动位置；浏览器前进/后退同样走这里
      if (isHomeRef.current) saveHomeScroll(filterKeyRef.current, window.scrollY);
      setRoute(h); setMenuOpen(false); setDrawerOpen(false); setSearchOpen(false);
      const nowHome = hashIsHome(h);
      isHomeRef.current = nowHome;
      if (nowHome) {
        const y = readHomeScroll(filterKeyRef.current);
        pendingRestoreRef.current = y;
        // 有存档则等 HomePage 列表渲染后恢复；无存档回顶部
        if (y == null) window.scrollTo(0, 0);
      } else {
        pendingRestoreRef.current = null;
        window.scrollTo(0, 0);
      }
    };
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
  // 抽屉已提升到 App 层：任何主页面点汉堡只开抽屉、停留在当前页，不再强制跳首页
  const openDrawer = () => setDrawerOpen(true);
  // 抽屉里点日期/标签：先设置过滤，非首页再带回首页看结果；已在首页则原地过滤（抽屉随之关闭）
  const pickDateAndGo = (d: string) => { setDateFilterf(d); setDrawerOpen(false); if (!isHome) go("#"); };
  const pickTagAndGo = (t: string) => { setTagFilterf(t); setDrawerOpen(false); if (!isHome) go("#"); };
  // 抽屉内改动过搜索词后关闭：非首页带回首页看搜索结果
  const drawerSearchCommit = () => { if (!isHome) go("#"); };
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
  // 公开独白只读页是真实路径 /n/<id>（sitemap 可爬；私密/归档/删除的 404），与分享页同渲染口径
  const pubMatch = location.pathname.match(/^\/n\/(\d+)$/);
  if (pubMatch) return <SharePage noteId={Number(pubMatch[1])} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={openDrawer} aria-label="打开菜单"><MenuIcon /></button>
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go("#"); }}>
          {site.logo ? <img src={site.logo} alt="" className="brand-logo" /> : site.name ? <span className="brand-badge">{site.name.slice(0, 1)}</span> : <span className="brand-badge brand-badge-blank" aria-hidden="true" />}
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
                    <button onClick={() => { setMenuOpen(false); go("#me/notes"); }}>我的独白</button>
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
              onChange={(e) => setQf(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }} />
            {q && <button type="button" className="icon-btn search-clear" aria-label="清除搜索" onClick={() => setQf("")}>✕</button>}
          </div>
        )}
      </header>

      <main className="container">
        {/* 管理后台已并入用户中心，#admin 深链直接落到用户中心的「管理后台」标签，不留死链 */}
        {isAdmin ? (
          user ? <MePage user={user} site={site} refreshUser={refreshUser} onEditNote={openEdit} onOpenNote={openNote} /> : <div className="empty">请先登录。<button className="text-btn" onClick={() => setAuthOpen(true)}>去登录</button></div>
        ) : isMe ? (
          user ? <MePage user={user} site={site} refreshUser={refreshUser} onEditNote={openEdit} onOpenNote={openNote} /> : <div className="empty">请先登录。<button className="text-btn" onClick={() => setAuthOpen(true)}>去登录</button></div>
        ) : isEdit ? (
          !user ? <div className="empty">请先登录。</div>
            : !editLoaded ? <div className="empty">加载中…</div>
            : <EditorPage key={editNote?.id || "new"} note={editNote} onCancel={() => go("#")} onSaved={(n) => go(`#note/${n.id}`)} />
        ) : noteId ? (
          <NoteDetail noteId={Number(noteId)} user={user} site={site} onBack={() => go("#")} onEdit={openEdit} onDeleted={() => go("#")}
            focusComments={commentFocus === Number(noteId)} onAuthRequest={() => setAuthOpen(true)}
            onTag={(t) => { setTagFilterf(t); go("#"); }} />
        ) : (
          <HomePage user={user} site={site} onOpenNote={openNote} onComment={openComment}
            q={q} onSearch={setQf}
            tag={tagFilter} onTag={setTagFilterf} date={dateFilter} onDate={setDateFilterf}
            month={calMonth} onMonth={setCalMonth} days={calDays} tags={allTags} onListSettled={handleListSettled} />
        )}
      </main>

      {/* 全局抽屉：首页/用户中心/详情/编辑等所有带顶栏的页面共用，点汉堡只开抽屉不跳页 */}
      <SiteDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        site={site} user={user} theme={theme} onToggleTheme={toggle}
        onLogout={() => void logout()} onOpenAuth={() => setAuthOpen(true)}
        onHome={() => { if (!isHome) go("#"); }}
        q={q} onSearch={setQf} onSearchCommit={drawerSearchCommit}
        tags={allTags} tag={tagFilter} onPickTag={pickTagAndGo}
        month={calMonth} days={calDays} date={dateFilter} onMonth={setCalMonth} onPickDate={pickDateAndGo} />

      <footer className="site-footer">
        <span>{site.name}{site.subtitle ? ` · ${site.subtitle}` : ""}</span>
        <a className="gh-link" href="https://github.com/wujinpai/notepro" target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目地址" title="GitHub 项目地址"><GithubIcon /></a>
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
