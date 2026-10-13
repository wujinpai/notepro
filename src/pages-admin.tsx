import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime, type NoteInfo, type UserInfo } from "./api";
import { Avatar } from "./components";

type AdminTab = "overview" | "users" | "notes" | "site" | "smtp" | "oauth" | "sso" | "weather" | "invite" | "upload";

export function AdminPage({ user, embedded = false }: { user: UserInfo; embedded?: boolean }) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const tabs: [AdminTab, string][] = [["overview", "概览"], ["users", "用户管理"], ["notes", "内容管理"], ["site", "站点设置"], ["smtp", "邮箱设置"], ["oauth", "第三方登录"], ["sso", "统一登录"], ["weather", "天气与位置"], ["invite", "邀请码"], ["upload", "上传设置"]];
  const content = (
    <>
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "notes" && <NotesAdmin />}
      {tab === "site" && <SiteSettings />}
      {tab === "smtp" && <SmtpSettings />}
      {tab === "oauth" && <OauthSettings />}
      {tab === "sso" && <SsoSettings />}
      {tab === "weather" && <GeoWeatherSettings />}
      {tab === "invite" && <InviteCodes />}
      {tab === "upload" && <UploadSettings />}
    </>
  );
  // 嵌入用户中心：不再套一层 me-layout，只留子标签行 + 内容（外层导航由用户中心承担）
  if (embedded) {
    return (
      <div className="stack">
        <div className="seg seg-scroll">
          {tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {content}
      </div>
    );
  }
  return (
    <div className="me-layout">
      <aside className="me-nav">
        <div className="me-card-brief">
          <Avatar url={user.avatar} name={user.nickname} size={56} />
          <strong>管理后台</strong>
          <span className="muted tiny">{user.nickname}（管理员）</span>
        </div>
        <div className="me-tabs">
          {tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
      </aside>
      <section className="me-main">
        {content}
      </section>
    </div>
  );
}

function Overview() {
  const [data, setData] = useState<{ users: number; notes: number; oauthBindings: number; todayUsers: number; todayNotes: number; todayVisits: number; totalViews: number; todayViews: number; recentUsers: UserInfo[] } | null>(null);
  useEffect(() => { api.get("/api/admin/overview").then((d) => setData(d as typeof data)).catch(() => undefined); }, []);
  if (!data) return <div className="panel">加载中…</div>;
  const cards: [string, number][] = [["用户总数", data.users], ["笔记总数", data.notes], ["第三方绑定", data.oauthBindings], ["今日新增用户", data.todayUsers], ["今日新增笔记", data.todayNotes], ["今日访问", data.todayVisits], ["总浏览", data.totalViews], ["今日浏览", data.todayViews]];
  return (
    <div className="stack">
      <div className="stat-grid">
        {cards.map(([label, v]) => <div key={label} className="stat-card"><strong>{v}</strong><span>{label}</span></div>)}
      </div>
      <BackupPanel />
      <div className="panel">
        <h3>最近注册用户</h3>
        {data.recentUsers.map((u) => (
          <div key={u.id} className="session-row">
            <span className="row-gap"><Avatar url={u.avatar} name={u.nickname} size={28} /> {u.nickname} <span className="muted tiny">@{u.username}</span></span>
            <span className="muted tiny">{fmtTime(u.createdAt)}{u.role === "admin" ? " · 管理员" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackupPanel() {
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const doExport = async () => {
    try {
      const d = await api.post<{ token: string }>("/api/admin/backup/token", {});
      window.location.href = `/api/admin/backup/download?token=${encodeURIComponent(d.token)}`;
    } catch (e) { setMsg((e as Error).message); }
  };
  const doRestore = async () => {
    if (!file) return;
    if (!confirm("确定用该备份文件恢复数据库吗？恢复前当前数据库会自动备份到 data/backups（保留最近 5 份）。恢复后必须重启容器生效。")) return;
    try {
      const r = (await api.upload("/api/admin/backup/restore", file)) as unknown as { message?: string };
      setMsg(r.message || "备份已恢复，请重启容器生效");
      setFile(null);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>数据备份</h3>
      <p className="muted tiny">备份为 SQLite 数据库文件（.db），存放在容器 data 卷。上传恢复会替换当前数据库：恢复前自动把当前库备份到 data/backups，上传后必须重启容器生效。</p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => void doExport()}>导出数据库备份</button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>上传备份恢复</button>
        <input ref={fileRef} type="file" accept=".db" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
      </div>
      {file && (
        <p className="row-gap" style={{ marginTop: 10 }}>
          <span className="muted tiny">已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</span>
          <button className="btn btn-danger btn-sm" onClick={() => void doRestore()}>确认恢复</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>取消</button>
        </p>
      )}
      {msg && <p className="ok-text">{msg}</p>}
    </div>
  );
}

interface AdminUser extends UserInfo { emailFull: string | null; oauth: string[] }
function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api.get<{ users: AdminUser[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((d) => setUsers(d.users)).catch(() => setUsers([]));
  }, [q]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try { await fn(); setMsg("操作成功"); load(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>用户管理</h3>
      <input className="search" value={q} placeholder="搜索用户名/昵称/邮箱…" onChange={(e) => setQ(e.target.value)} />
      {msg && <p className="ok-text">{msg}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>用户</th><th>邮箱</th><th>第三方</th><th>注册时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><span className="row-gap"><Avatar url={u.avatar} name={u.nickname} size={26} /> {u.nickname} <span className="muted tiny">@{u.username}</span>{u.role === "admin" && <span className="badge badge-pin">管理员</span>}</span></td>
                <td>{u.emailFull || "—"}</td>
                <td>{u.oauth.length ? u.oauth.map((x) => (x === "github" ? "GitHub" : "QQ")).join("、") : "—"}</td>
                <td>{fmtTime(u.createdAt)}</td>
                <td>{u.status === "active" ? "正常" : "已禁用"}</td>
                <td>
                  <div className="row-gap">
                    {u.status === "active"
                      ? <button className="btn btn-ghost btn-sm" onClick={() => void act(() => api.patch(`/api/admin/users/${u.id}`, { status: "disabled" }), `禁用 ${u.nickname}？其会话将失效，公开笔记将下架。`)}>禁用</button>
                      : <button className="btn btn-ghost btn-sm" onClick={() => void act(() => api.patch(`/api/admin/users/${u.id}`, { status: "active" }))}>启用</button>}
                    {u.role === "admin"
                      ? <button className="btn btn-ghost btn-sm" onClick={() => void act(() => api.patch(`/api/admin/users/${u.id}`, { role: "user" }))}>取消管理员</button>
                      : <button className="btn btn-ghost btn-sm" onClick={() => void act(() => api.patch(`/api/admin/users/${u.id}`, { role: "admin" }))}>设为管理员</button>}
                    <button className="btn btn-danger btn-sm" onClick={() => void act(() => api.del(`/api/admin/users/${u.id}`), `删除 ${u.nickname}？其笔记、媒体、绑定与会话将被级联删除。`)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotesAdmin() {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const load = useCallback(() => { api.get<{ notes: NoteInfo[] }>("/api/admin/notes").then((d) => setNotes(d.notes)).catch(() => setNotes([])); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="panel">
      <h3>内容管理</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>作者</th><th>可见性</th><th>浏览数</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td>{n.title || n.content.slice(0, 30)}</td>
                <td>{n.author?.nickname}</td>
                <td>{n.archived ? "归档" : n.visibility === "private" ? "私密" : "公开"}</td>
                <td>{n.viewCount}</td>
                <td>{fmtTime(n.createdAt)}</td>
                <td>
                  <div className="row-gap">
                    {n.visibility === "public" && <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm("下架这篇笔记（改为私密）？")) void api.post(`/api/admin/notes/${n.id}/takedown`).then(load); }}>下架</button>}
                    <button className="btn btn-danger btn-sm" onClick={() => { if (confirm("删除这篇笔记？")) void api.del(`/api/notes/${n.id}`).then(load); }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACCENT_PRESETS = ["#1a73e8", "#d6336c", "#e03131", "#e8590c", "#f08c00", "#2f9e44", "#1098ad", "#7048e8"];

function SiteSettings() {
  const [f, setF] = useState({ name: "", subtitle: "", description: "", keywords: "", footer: "", icp: "", logo: "", url: "", accent: "", registerOpen: true, oauthShowLogin: true });
  const [msg, setMsg] = useState("");
  useEffect(() => { api.get<typeof f>("/api/admin/site").then(setF).catch(() => undefined); }, []);
  const save = async () => {
    try { await api.put("/api/admin/site", f); setMsg("站点设置已保存"); } catch (e) { setMsg((e as Error).message); }
  };
  const logo = async (file: File) => {
    try { const r = await api.upload("/api/admin/logo", file); setF({ ...f, logo: r.path }); setMsg("Logo 已上传"); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>站点设置</h3>
      <div className="form">
        <label>站点名称<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>副标题<input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></label>
        <label>站点地址（可空，用于生成 OAuth 回调；留空则按访问域名推导）<input value={f.url} placeholder="https://note.example.com" onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <label>SEO 描述<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} /></label>
        <label>SEO 关键词<input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></label>
        <label>页脚文案<input value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></label>
        <label>ICP 备案号（页脚固定链接到工信部备案系统，留空则不显示）<input value={f.icp} placeholder="黔ICP备2026016351号-1" onChange={(e) => setF({ ...f, icp: e.target.value })} /></label>
        <label>主题强调色（按钮、选中标签、链接等，留空为默认蓝色）
          <span className="row-gap" style={{ flexWrap: "wrap" }}>
            {ACCENT_PRESETS.map((c) => (
              <button key={c} type="button" aria-label={`强调色 ${c}`} title={c}
                onClick={() => setF({ ...f, accent: f.accent.toLowerCase() === c ? "" : c })}
                style={{ width: 30, height: 30, borderRadius: 7, background: c, border: f.accent.toLowerCase() === c ? "2px solid var(--text)" : "1px solid var(--border)", cursor: "pointer", padding: 0 }} />
            ))}
            <input type="color" aria-label="自定义强调色" title="自定义强调色" value={/^#[0-9a-fA-F]{6}$/.test(f.accent) ? f.accent : "#1a73e8"}
              onChange={(e) => setF({ ...f, accent: e.target.value })} style={{ width: 34, height: 30, padding: 2, borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }} />
            {f.accent && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, accent: "" })}>恢复默认</button>}
          </span>
        </label>
        <label className="check"><input type="checkbox" checked={f.registerOpen} onChange={(e) => setF({ ...f, registerOpen: e.target.checked })} /> 开放注册</label>
        <label className="check"><input type="checkbox" checked={f.oauthShowLogin} onChange={(e) => setF({ ...f, oauthShowLogin: e.target.checked })} /> 登录弹窗显示第三方登录入口</label>
        <label>站点 Logo
          <span className="row-gap">
            {f.logo && <img src={f.logo} alt="logo" className="logo-preview" />}
            <label className="btn btn-ghost btn-sm">上传 Logo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void logo(file); }} /></label>
          </span>
        </label>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => void save()}>保存设置</button>
      </div>
    </div>
  );
}

function SmtpSettings() {
  const [f, setF] = useState({ host: "", port: 465, secure: true, user: "", from: "", fromName: "", enabled: true, hasPass: false });
  const [pass, setPass] = useState("");
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { api.get<typeof f>("/api/admin/smtp").then(setF).catch(() => undefined); }, []);
  const save = async () => {
    try { await api.put("/api/admin/smtp", { ...f, pass: pass || undefined }); setPass(""); setMsg("邮箱设置已保存并即时生效"); }
    catch (e) { setMsg((e as Error).message); }
  };
  const test = async () => {
    try { await api.post("/api/admin/smtp/test", { to: testTo }); setMsg("测试邮件已发送"); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>邮箱设置（SMTP）</h3>
      <p className="muted tiny">验证码邮件由此发送。未配置时验证码会打印到服务端日志（docker logs 搜 [email-code]）。</p>
      <div className="form">
        <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> 启用后台 SMTP 配置（关闭则回退环境变量 SMTP_*）</label>
        <label>SMTP 主机<input value={f.host} placeholder="smtp.example.com" onChange={(e) => setF({ ...f, host: e.target.value })} /></label>
        <div className="opt-grid">
          <label>端口<input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> SSL/TLS（465 常用）</label>
        </div>
        <label>发信账号<input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></label>
        <label>账号密码 / 授权码<input type="password" value={pass} placeholder={f.hasPass ? "已设置（留空不改）" : "未设置"} onChange={(e) => setPass(e.target.value)} /></label>
        <label>发件人邮箱<input value={f.from} placeholder="留空则用发信账号" onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>发件人显示名<input value={f.fromName} placeholder="如 己素" onChange={(e) => setF({ ...f, fromName: e.target.value })} /></label>
        <label>测试收件邮箱
          <span className="code-row">
            <input value={testTo} placeholder="留空则发给当前管理员邮箱" onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" className="btn btn-ghost" onClick={() => void test()}>发送测试邮件</button>
          </span>
        </label>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => void save()}>保存邮箱设置</button>
      </div>
    </div>
  );
}

function GeoWeatherSettings() {
  const [w, setW] = useState({ enabled: true, hasKey: false, hasHost: false });
  const [g, setG] = useState({ enabled: true, hasKey: false });
  const [wKey, setWKey] = useState("");
  const [wHost, setWHost] = useState("");
  const [gKey, setGKey] = useState("");
  const [wMsg, setWMsg] = useState("");
  const [gMsg, setGMsg] = useState("");
  const [wTesting, setWTesting] = useState(false);
  const [gTesting, setGTesting] = useState(false);
  const [foldPref, setFoldPref] = useState<boolean | undefined>(() => {
    try { const v = localStorage.getItem("np-weather-fold"); return v === null ? undefined : v === "1"; } catch { return undefined; }
  });
  const [folded, setFolded] = useState(true);
  useEffect(() => {
    api.get<{ weather: { enabled: boolean; hasKey: boolean; hasHost: boolean }; geo: { enabled: boolean; hasKey: boolean } }>("/api/admin/geo").then((d) => {
      setW(d.weather); setG(d.geo);
      if (foldPref === undefined) setFolded(d.weather.hasKey || d.geo.hasKey);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const collapsed = foldPref ?? folded;
  const toggle = () => {
    const next = !collapsed;
    setFoldPref(next);
    try { localStorage.setItem("np-weather-fold", next ? "1" : "0"); } catch { /* ignore */ }
  };
  const status = (w.enabled && w.hasKey) || (g.enabled && g.hasKey) ? "已启用" : (w.hasKey || g.hasKey) ? "未启用" : "未配置";
  const saveW = async (clear: "key" | "host" | false = false) => {
    try {
      const body = clear === "key"
        ? { weather: { enabled: w.enabled, clearKey: true } }
        : clear === "host"
          ? { weather: { enabled: w.enabled, clearHost: true } }
          : { weather: { enabled: w.enabled, key: wKey || undefined, host: wHost || undefined } };
      const d = await api.put<{ weather: { hasKey: boolean; hasHost: boolean } }>("/api/admin/geo", body);
      setWKey(""); setWHost(""); setW((s) => ({ ...s, hasKey: d.weather.hasKey, hasHost: d.weather.hasHost }));
      setWMsg(clear === "key" ? "和风 KEY 已清空，未配置时自动获取回退 Open-Meteo"
        : clear === "host" ? "和风 API Host 已清空，未配置时自动获取回退 Open-Meteo"
        : "天气设置已保存并即时生效");
    } catch (e) { setWMsg((e as Error).message); }
  };
  const saveG = async (clear = false) => {
    try {
      const d = await api.put<{ geo: { hasKey: boolean } }>("/api/admin/geo", clear ? { geo: { enabled: g.enabled, clearKey: true } } : { geo: { enabled: g.enabled, key: gKey || undefined } });
      setGKey(""); setG((s) => ({ ...s, hasKey: d.geo.hasKey }));
      setGMsg(clear ? "腾讯 Key 已清空，未配置时自动获取回退 BigDataCloud" : "位置设置已保存并即时生效");
    } catch (e) { setGMsg((e as Error).message); }
  };
  const testW = () => {
    setWTesting(true); setWMsg("");
    const run = (lat?: number, lon?: number) =>
      api.post<{ ok: boolean; desc?: string; temp?: number; error?: string }>("/api/admin/geo/test-weather", lat != null ? { lat, lon } : {})
        .then((d) => setWMsg(d.ok
          ? `测试成功：${d.desc}${Number.isFinite(d.temp) ? ` ${Math.round(d.temp as number)}°C` : ""}`
          : `测试失败：${d.error || "未知错误"}`))
        .catch((e) => setWMsg(`测试失败：${(e as Error).message}`))
        .finally(() => setWTesting(false));
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => void run(p.coords.latitude, p.coords.longitude),
        () => void run(),
        { timeout: 8000, maximumAge: 600000 },
      );
    } else void run();
  };
  const testG = async () => {
    setGTesting(true); setGMsg("");
    try {
      const d = await api.post<{ ok: boolean; label?: string; district?: string; city?: string; error?: string }>("/api/admin/geo/test-geo", {});
      setGMsg(d.ok ? `测试成功：${d.label}（${d.district || ""}${d.city ? ` / ${d.city}` : ""}）` : `测试失败：${d.error || "未知错误"}`);
    } catch (e) { setGMsg(`测试失败：${(e as Error).message}`); }
    finally { setGTesting(false); }
  };
  return (
    <div className="panel oauth-card">
      <button type="button" className="oauth-fold-head" aria-expanded={!collapsed} onClick={toggle}>
        <span className="oauth-fold-title">天气与位置</span>
        <span className={`badge${status === "已启用" ? " badge-pin" : ""}`}>{status}</span>
        <svg className={`cal-chevron${collapsed ? "" : " open"}`} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`oauth-collapse${collapsed ? "" : " open"}`}>
        <div className="oauth-collapse-inner">
          <h4 style={{ margin: "6px 0 2px" }}>天气（和风天气）</h4>
          <p className="muted tiny">编辑器「自动获取」的天气来源。配置后优先使用和风实况（观测数据），未配置或失败时静默回退 Open-Meteo。在 <a href="https://dev.qweather.com" target="_blank" rel="noreferrer">dev.qweather.com</a> 注册免费订阅后把 KEY 填到下面（只存加密值，永不回显）。和风新版要求使用专属 API Host：去 <a href="https://console.qweather.com" target="_blank" rel="noreferrer">console.qweather.com</a> → 设置/API 管理复制，只填主机名（如 abc123.def.qweatherapi.com），不要带 https://。</p>
          <div className="form">
            <label className="check"><input type="checkbox" checked={w.enabled} onChange={(e) => setW({ ...w, enabled: e.target.checked })} /> 启用和风天气实况</label>
            <label>QWeather API KEY<input type="password" value={wKey} placeholder={w.hasKey ? "已设置（留空不改）" : "未设置"} onChange={(e) => setWKey(e.target.value)} autoComplete="off" /></label>
            <label>和风 API Host<input value={wHost} placeholder={w.hasHost ? "已设置（留空不改）" : "如 your-host.qweatherapi.com"} onChange={(e) => setWHost(e.target.value)} autoComplete="off" /></label>
          </div>
          {wMsg && <p className="ok-text">{wMsg}</p>}
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => void saveW(false)}>保存天气</button>
            <button className="btn btn-ghost" disabled={wTesting} onClick={testW}>{wTesting ? "测试中…" : "测试"}</button>
            {w.hasKey && <button className="btn btn-danger btn-sm" onClick={() => void saveW("key")}>清空 KEY</button>}
            {w.hasHost && <button className="btn btn-ghost btn-sm" onClick={() => void saveW("host")}>清空 Host</button>}
          </div>
          <h4 style={{ margin: "14px 0 2px" }}>位置（腾讯位置服务）</h4>
          <p className="muted tiny">编辑器「自动获取」的位置来源。配置后优先使用腾讯逆地理（区县精度），未配置或失败时静默回退 BigDataCloud。在 <a href="https://lbs.qq.com" target="_blank" rel="noreferrer">lbs.qq.com</a> 申请 Key 后填到下面（只存加密值，永不回显）。</p>
          <div className="form">
            <label className="check"><input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} /> 启用腾讯位置服务逆地理</label>
            <label>腾讯位置服务 Key<input type="password" value={gKey} placeholder={g.hasKey ? "已设置（留空不改）" : "未设置"} onChange={(e) => setGKey(e.target.value)} autoComplete="off" /></label>
          </div>
          {gMsg && <p className="ok-text">{gMsg}</p>}
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => void saveG(false)}>保存位置</button>
            <button className="btn btn-ghost" disabled={gTesting} onClick={() => void testG()}>{gTesting ? "测试中…" : "测试"}</button>
            {g.hasKey && <button className="btn btn-danger btn-sm" onClick={() => void saveG(true)}>清空 KEY</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
function OauthSettings() {
  const [providers, setProviders] = useState<Record<string, { enabled: boolean; clientId: string; hasSecret: boolean; callback: string }>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  // 卡片折叠偏好：用户手动切换后记入 localStorage；未手动切换时按是否已配置决定默认态
  const readFoldPref = (p: string): boolean | undefined => {
    try { const v = localStorage.getItem(`np-oauth-fold-${p}`); return v === null ? undefined : v === "1"; } catch { return undefined; }
  };
  const [foldPref, setFoldPref] = useState<Record<string, boolean | undefined>>(() => ({ github: readFoldPref("github"), qq: readFoldPref("qq") }));
  const toggleFold = (p: string, collapsed: boolean) => {
    const next = !collapsed;
    setFoldPref((f) => ({ ...f, [p]: next }));
    try { localStorage.setItem(`np-oauth-fold-${p}`, next ? "1" : "0"); } catch { /* ignore */ }
  };
  const load = useCallback(() => {
    api.get<{ providers: typeof providers }>("/api/admin/oauth").then((d) => setProviders(d.providers)).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (p: string) => {
    const cfg = providers[p];
    try {
      await api.put(`/api/admin/oauth/${p}`, { enabled: cfg.enabled, clientId: cfg.clientId, secret: secrets[p] || undefined });
      setSecrets({ ...secrets, [p]: "" }); setMsg(`${p === "github" ? "GitHub" : "QQ"} 设置已保存`); load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const test = async (p: string) => {
    try { const d = await api.post<{ message: string }>("/api/admin/oauth/test", { provider: p }); setMsg(d.message); }
    catch (e) { setMsg((e as Error).message); }
  };
  const meta: Record<string, { label: string; idLabel: string; secretLabel: string; where: string }> = {
    github: { label: "GitHub", idLabel: "Client ID", secretLabel: "Client Secret", where: "GitHub → Settings → Developer settings → OAuth Apps" },
    qq: { label: "QQ", idLabel: "App ID", secretLabel: "App Key", where: "QQ 互联 connect.qq.com → 应用管理" },
  };
  const copyCallback = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("回调地址已复制");
    } catch {
      setMsg("复制失败，请手动选中复制");
    }
  };
  return (
    <div className="stack">
      {Object.entries(meta).map(([p, m]) => {
        const cfg = providers[p] || { enabled: false, clientId: "", hasSecret: false, callback: "" };
        // 默认态：已填凭据（Client ID/App ID 有值）→ 收起；未配置 → 展开；用户手动切换覆盖默认
        const collapsed = foldPref[p] ?? !!cfg.clientId;
        const status = cfg.enabled ? "已启用" : cfg.clientId ? "未启用" : "未配置";
        return (
          <div key={p} className="panel oauth-card">
            <button type="button" className="oauth-fold-head" aria-expanded={!collapsed} onClick={() => toggleFold(p, collapsed)}>
              <span className="oauth-fold-title">{m.label} 登录</span>
              <span className={`badge${cfg.enabled ? " badge-pin" : ""}`}>{status}</span>
              <svg className={`cal-chevron${collapsed ? "" : " open"}`} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className={`oauth-collapse${collapsed ? "" : " open"}`}>
              <div className="oauth-collapse-inner">
            {p === "github" ? (
              <p className="muted tiny">在 {m.where} 创建 OAuth App，把下方回调地址填到应用的 Authorization callback URL，再把 {m.idLabel} 与{m.secretLabel}填回来。</p>
            ) : (
              <div className="muted tiny" style={{ lineHeight: 1.9 }}>
                <p style={{ margin: "4px 0" }}>在 {m.where} 创建「网站应用」，拿到 App ID（纯数字）与 App Key：</p>
                <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
                  <li>App ID 填的是<b>纯数字 ID</b>：不要带空格，也不要把 App Key 填到这里。若 QQ 跳到「公共返回码说明」报 <b>errcode=100008（client id is illegal）</b>，就是这里填错了。</li>
                  <li>应用「<b>审核中</b>」时，只有设为<b>调试QQ号</b>的账号能登录：去 QQ 互联应用管理把你的 QQ 号加为调试QQ号；审核通过后所有 QQ 号可用。</li>
                  <li>在 QQ 互联的应用信息里填写「<b>网站回调域</b>」：只填域名（例如 jisu.cn，不带 https:// 与路径），必须与下方回调地址的域名一致。</li>
                  <li>把下方「本站回调地址」<b>逐字复制</b>到 QQ 互联应用的回调地址设置里。</li>
                </ol>
              </div>
            )}
            <div className="form">
              <label className="check"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setProviders({ ...providers, [p]: { ...cfg, enabled: e.target.checked } })} /> 启用{m.label}登录</label>
              <label>本站回调地址
                <span className="code-row">
                  <input value={cfg.callback} readOnly onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyCallback(cfg.callback)}>复制</button>
                </span>
              </label>
              <label>{m.idLabel}<input value={cfg.clientId} placeholder={p === "qq" ? "纯数字，如 123456789" : ""} onChange={(e) => setProviders({ ...providers, [p]: { ...cfg, clientId: e.target.value.trim() } })} /></label>
              <label>{m.secretLabel}<input type="password" value={secrets[p] || ""} placeholder={cfg.hasSecret ? "已设置（留空不改）" : "未设置"} onChange={(e) => setSecrets({ ...secrets, [p]: e.target.value.trim() })} /></label>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => void save(p)}>保存{m.label}设置</button>
              <button className="btn btn-ghost" onClick={() => void test(p)}>测试配置</button>
            </div>
              </div>
            </div>
          </div>
        );
      })}
      {msg && <p className="ok-text">{msg}</p>}
    </div>
  );
}

// ---------- 统一登录 SSO（作为提供方，供云盘等自有应用跳转登录） ----------
function SsoSettings() {
  const [f, setF] = useState({ enabled: false, hasSecret: false, redirectUris: "" });
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api.get<{ enabled: boolean; hasSecret: boolean; redirectUris: string }>("/api/admin/sso")
      .then((d) => setF({ enabled: d.enabled, hasSecret: d.hasSecret, redirectUris: d.redirectUris }))
      .catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    try {
      await api.put("/api/admin/sso", { enabled: f.enabled, secret: secret || undefined, redirectUris: f.redirectUris });
      setSecret(""); setMsg("已保存"); load();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="stack">
      <div className="panel">
        <h3>统一登录（SSO 提供方）</h3>
        <p className="muted tiny" style={{ lineHeight: 1.9 }}>
          开启后，自有应用（如云盘）可跳转到本站登录，登录成功后带着一次性授权码跳回应用。
          密钥由本站与应用双方各存一份（本站加密存储），回调地址白名单防授权码外泄。
        </p>
        <div className="form">
          <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> 启用 SSO 提供方</label>
          <label>共享密钥<input type="password" value={secret} placeholder={f.hasSecret ? "已设置（留空不改）" : "与云盘端填入同一串密钥"} onChange={(e) => setSecret(e.target.value.trim())} /></label>
          <label>回调地址白名单（每行一个，需精确到路径）
            <textarea rows={3} value={f.redirectUris} placeholder={"https://drive.jisu.cn/api/auth/callback"} onChange={(e) => setF({ ...f, redirectUris: e.target.value })} />
          </label>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => void save()}>保存 SSO 设置</button>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
      </div>
    </div>
  );
}

// ---------- 邀请码 ----------
interface InviteCodeRow { code: string; created_at: number; used_at: number | null; used_by: number | null; used_by_name: string | null }
function InviteCodes() {
  const [rows, setRows] = useState<InviteCodeRow[]>([]);
  const [inviteOnly, setInviteOnly] = useState(false);
  const [count, setCount] = useState(5);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await api.get<{ codes: InviteCodeRow[]; inviteOnly: boolean }>("/api/admin/invite-codes");
      setRows(d.codes); setInviteOnly(d.inviteOnly);
    } catch (e) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (v: boolean) => {
    setInviteOnly(v);
    try { await api.put("/api/admin/site", { inviteOnly: v }); setMsg(v ? "已开启邀请码注册" : "已关闭邀请码注册"); }
    catch (e) { setMsg((e as Error).message); setInviteOnly(!v); }
  };
  const gen = async () => {
    try {
      const d = await api.post<{ codes: string[] }>("/api/admin/invite-codes", { count });
      setMsg(`已生成 ${d.codes.length} 个邀请码`);
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const del = async (code: string) => {
    if (!confirm(`删除邀请码 ${code}？`)) return;
    try { await api.del(`/api/admin/invite-codes/${code}`); setMsg("已删除"); await load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setMsg(`已复制 ${code}`); }
    catch { setMsg("复制失败"); }
  };
  return (
    <div className="panel">
      <h3>邀请码</h3>
      <div className="form">
        <label className="check"><input type="checkbox" checked={inviteOnly} onChange={(e) => void toggle(e.target.checked)} /> 开启邀请码注册（开启后，新用户注册必须填写未使用的邀请码）</label>
        <label>生成数量
          <span className="row-gap">
            <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} style={{ width: 90 }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void gen()}>生成邀请码</button>
          </span>
        </label>
        <p className="muted tiny">一个邀请码只能注册一个用户；已使用的邀请码会标记使用者，不可删除。</p>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>邀请码</th><th>生成时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td><code>{r.code}</code></td>
                <td className="muted tiny">{fmtTime(r.created_at)}</td>
                <td>{r.used_at ? <span className="tag-used">已使用{r.used_by_name ? ` · @${r.used_by_name}` : ""}</span> : <span className="tag-unused">未使用</span>}</td>
                <td>
                  <span className="row-gap">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(r.code)}>复制</button>
                    {!r.used_at && <button type="button" className="btn btn-danger btn-sm" onClick={() => void del(r.code)}>删除</button>}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">暂无邀请码</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 上传设置 ----------
function UploadSettings() {
  const [f, setF] = useState({ videoEnabled: true, videoMaxMb: 10, fileEnabled: true, fileMaxMb: 10 });
  const [msg, setMsg] = useState("");
  useEffect(() => { api.get<typeof f>("/api/admin/upload").then(setF).catch(() => undefined); }, []);
  const save = async () => {
    try { await api.put("/api/admin/upload", f); setMsg("上传设置已保存"); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>上传设置</h3>
      <div className="form">
        <label className="check"><input type="checkbox" checked={f.videoEnabled} onChange={(e) => setF({ ...f, videoEnabled: e.target.checked })} /> 允许上传视频（MP4/WebM/MOV）</label>
        <label>视频大小限制（MB）
          <input type="number" min={1} max={100} value={f.videoMaxMb}
            onChange={(e) => setF({ ...f, videoMaxMb: Math.max(1, Math.min(100, Number(e.target.value) || 10)) })} style={{ width: 100 }} />
        </label>
        <label className="check"><input type="checkbox" checked={f.fileEnabled} onChange={(e) => setF({ ...f, fileEnabled: e.target.checked })} /> 允许上传文件（PDF/Word/Excel/PPT/TXT/ZIP/RAR/7z）</label>
        <label>文件大小限制（MB）
          <input type="number" min={1} max={100} value={f.fileMaxMb}
            onChange={(e) => setF({ ...f, fileMaxMb: Math.max(1, Math.min(100, Number(e.target.value) || 10)) })} style={{ width: 100 }} />
        </label>
        <p className="muted tiny">图片限制固定为 5MB；每篇独白最多 3 个视频。关闭某项上传后，编辑器不再显示对应按钮，已发布内容不受影响。</p>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => void save()}>保存设置</button>
      </div>
    </div>
  );
}
