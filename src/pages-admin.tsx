import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, type NoteInfo, type UserInfo } from "./api";
import { Avatar } from "./components";

type AdminTab = "overview" | "users" | "notes" | "site" | "smtp" | "oauth";

export function AdminPage({ user, embedded = false }: { user: UserInfo; embedded?: boolean }) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const tabs: [AdminTab, string][] = [["overview", "概览"], ["users", "用户管理"], ["notes", "内容管理"], ["site", "站点设置"], ["smtp", "邮箱设置"], ["oauth", "第三方登录"]];
  const content = (
    <>
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "notes" && <NotesAdmin />}
      {tab === "site" && <SiteSettings />}
      {tab === "smtp" && <SmtpSettings />}
      {tab === "oauth" && <OauthSettings />}
    </>
  );
  // 嵌入用户中心：不再套一层 me-layout，只留子标签行 + 内容（外层导航由用户中心承担）
  if (embedded) {
    return (
      <div className="stack">
        <div className="seg seg-wrap">
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
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </aside>
      <section className="me-main">
        {content}
      </section>
    </div>
  );
}

function Overview() {
  const [data, setData] = useState<{ users: number; notes: number; oauthBindings: number; todayUsers: number; todayNotes: number; todayVisits: number; recentUsers: UserInfo[] } | null>(null);
  useEffect(() => { api.get("/api/admin/overview").then((d) => setData(d as typeof data)).catch(() => undefined); }, []);
  if (!data) return <div className="panel">加载中…</div>;
  const cards: [string, number][] = [["用户总数", data.users], ["笔记总数", data.notes], ["第三方绑定", data.oauthBindings], ["今日新增用户", data.todayUsers], ["今日新增笔记", data.todayNotes], ["今日访问", data.todayVisits]];
  return (
    <div className="stack">
      <div className="stat-grid">
        {cards.map(([label, v]) => <div key={label} className="stat-card"><strong>{v}</strong><span>{label}</span></div>)}
      </div>
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
          <thead><tr><th>标题</th><th>作者</th><th>可见性</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td>{n.title || n.content.slice(0, 30)}</td>
                <td>{n.author?.nickname}</td>
                <td>{n.archived ? "归档" : n.visibility === "private" ? "私密" : "公开"}</td>
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

function SiteSettings() {
  const [f, setF] = useState({ name: "", subtitle: "", description: "", keywords: "", footer: "", icp: "", logo: "", url: "", registerOpen: true, oauthShowLogin: true });
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
      <button className="btn btn-primary" onClick={() => void save()}>保存设置</button>
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
      <button className="btn btn-primary" onClick={() => void save()}>保存邮箱设置</button>
    </div>
  );
}

function OauthSettings() {
  const [providers, setProviders] = useState<Record<string, { enabled: boolean; clientId: string; hasSecret: boolean; callback: string }>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
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
  return (
    <div className="stack">
      {Object.entries(meta).map(([p, m]) => {
        const cfg = providers[p] || { enabled: false, clientId: "", hasSecret: false, callback: "" };
        return (
          <div key={p} className="panel">
            <h3>{m.label} 登录</h3>
            <p className="muted tiny">在 {m.where} 创建应用，把下方回调地址填到开放平台，再把 {m.idLabel} 与{m.secretLabel}填回来。{m.label === "QQ" ? "QQ 还需在平台填写网站回调域。" : ""}</p>
            <div className="form">
              <label className="check"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setProviders({ ...providers, [p]: { ...cfg, enabled: e.target.checked } })} /> 启用{m.label}登录</label>
              <label>本站回调地址<input value={cfg.callback} readOnly onFocus={(e) => e.target.select()} /></label>
              <label>{m.idLabel}<input value={cfg.clientId} onChange={(e) => setProviders({ ...providers, [p]: { ...cfg, clientId: e.target.value } })} /></label>
              <label>{m.secretLabel}<input type="password" value={secrets[p] || ""} placeholder={cfg.hasSecret ? "已设置（留空不改）" : "未设置"} onChange={(e) => setSecrets({ ...secrets, [p]: e.target.value })} /></label>
            </div>
            <div className="row-gap">
              <button className="btn btn-primary" onClick={() => void save(p)}>保存{m.label}设置</button>
              <button className="btn btn-ghost" onClick={() => void test(p)}>测试配置</button>
            </div>
          </div>
        );
      })}
      {msg && <p className="ok-text">{msg}</p>}
    </div>
  );
}
