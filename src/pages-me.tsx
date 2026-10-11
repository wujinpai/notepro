import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { Avatar, Lightbox, LocationBadge, Modal, PlaneIcon, ShareDialog, SliderCaptcha, WeatherBadge, imageHit } from "./components";
import { renderMarkdown } from "./md";
import { AdminPage } from "./pages-admin";

interface SessionRow { id: number; ua: string; ip: string; created_at: number; current: boolean }
interface Binding { provider: string; provider_nickname: string; provider_avatar: string; created_at: number }

export function MePage({ user, site, refreshUser, onEditNote, onOpenNote }: {
  user: UserInfo; site: SiteInfo; refreshUser: () => void;
  onEditNote: (n: NoteInfo) => void; onOpenNote: (n: NoteInfo) => void;
}) {
  const [tab, setTab] = useState<"profile" | "security" | "notes" | "accounts" | "admin">(() => {
    if (location.hash.includes("admin") && user.role === "admin") return "admin";
    if (location.hash.includes("notes")) return "notes";
    if (location.hash.includes("accounts")) return "accounts";
    if (location.hash.includes("security")) return "security";
    return "profile";
  });
  // 已在本页时通过菜单/地址栏切换 hash（#me ↔ #me/notes ↔ #admin）不重挂载，靠监听同步标签
  useEffect(() => {
    const sync = () => {
      const h = location.hash;
      if (h.includes("admin") && user.role === "admin") setTab("admin");
      else if (h.includes("notes")) setTab("notes");
      else if (h.includes("accounts")) setTab("accounts");
      else if (h.includes("security")) setTab("security");
      else if (h === "#me") setTab("profile");
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [user.role]);
  return (
    <div className="me-layout">
      <aside className="me-nav">
        <div className="me-card-brief">
          <Avatar url={user.avatar} name={user.nickname} size={56} />
          <strong>{user.nickname}</strong>
          <span className="muted tiny">@{user.username} · ID {user.id}{user.role === "admin" ? " · 管理员" : ""}</span>
        </div>
        <div className="me-tabs">
          <button className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>个人资料</button>
          <button className={tab === "security" ? "on" : ""} onClick={() => setTab("security")}>账号安全</button>
          <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>我的独白</button>
          <button className={tab === "accounts" ? "on" : ""} onClick={() => setTab("accounts")}>第三方账号</button>
          {user.role === "admin" && <button className={tab === "admin" ? "on" : ""} onClick={() => setTab("admin")}>管理后台</button>}
        </div>
      </aside>
      <section className="me-main">
        {tab === "profile" && <ProfileTab user={user} refreshUser={refreshUser} />}
        {tab === "security" && <SecurityTab user={user} refreshUser={refreshUser} />}
        {tab === "notes" && <MyNotesTab onEditNote={onEditNote} onOpenNote={onOpenNote} />}
        {tab === "accounts" && <AccountsTab site={site} />}
        {tab === "admin" && user.role === "admin" && <AdminPage user={user} embedded />}
      </section>
    </div>
  );
}

function ProfileTab({ user, refreshUser }: { user: UserInfo; refreshUser: () => void }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [signature, setSignature] = useState(user.signature);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); };
  const uploadAvatar = async () => {
    if (!file) return;
    setBusy(true);
    try { await api.upload("/api/me/avatar", file); setMsg("头像已更新"); setFile(null); refreshUser(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.patch("/api/me/profile", { nickname, signature }); setMsg("资料已保存"); refreshUser(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <h3>个人资料</h3>
      <div className="avatar-edit">
        <div className="avatar-preview-box">
          {preview ? <img src={preview} alt="头像预览" /> : <Avatar url={user.avatar} name={user.nickname} size={96} />}
        </div>
        <div>
          <p className="muted tiny">方形预览，确认后上传。支持 PNG/JPG/GIF/WebP，最大 5MB。</p>
          <div className="avatar-actions">
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>选择图片</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
            {file && <button className="btn btn-primary" disabled={busy} onClick={() => void uploadAvatar()}>上传头像</button>}
          </div>
        </div>
      </div>
      <div className="form">
        <label>昵称<input value={nickname} onChange={(e) => setNickname(e.target.value)} /></label>
        <label>个性签名<input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="一句话介绍自己" /></label>
        <label>用户名<input value={user.username} disabled /></label>
        <label>邮箱<input value={user.email || "未绑定"} disabled /></label>
        <label>注册时间<input value={fmtTime(user.createdAt)} disabled /></label>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>保存资料</button>
    </div>
  );
}

function CodeBox({ onSend, busy, left, label }: { onSend: () => void; busy: boolean; left: number; label: string }) {
  return <button type="button" className="btn btn-ghost" disabled={busy || left > 0} onClick={onSend}>{left > 0 ? `${left}s` : label}</button>;
}

function BindEmailModal({ user, onClose, onDone }: { user: UserInfo; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [sliderKey, setSliderKey] = useState(0);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState("");
  useEffect(() => { const t = left > 0 ? setTimeout(() => setLeft(left - 1), 1000) : undefined; return () => clearTimeout(t); }, [left]);
  const sendBindCode = async () => {
    if (!ticket) { setMsg("请先完成滑块验证"); return; }
    try { await api.post("/api/me/send-bind-code", { email: email.trim(), ticket }); setLeft(60); setTicket(""); setSliderKey((k) => k + 1); setMsg("验证码已发送"); }
    catch (e) { setMsg((e as Error).message); }
  };
  const bind = async () => {
    try { await api.post("/api/me/bind-email", { email: email.trim(), code: code.trim() }); setMsg("邮箱已更新"); onDone(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title={user.email ? "换绑邮箱" : "绑定邮箱"} onClose={onClose}>
      <p className="muted tiny">当前邮箱：{user.email || "未绑定"}。只需验证新邮箱的验证码即可完成{user.email ? "换绑" : "绑定"}，无需输入当前密码。</p>
      <div className="form">
        <label>新邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="新邮箱地址" /></label>
        <label>新邮箱验证码
          <span className="code-row">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
            <CodeBox onSend={() => void sendBindCode()} busy={false} left={left} label="发送验证码" />
          </span>
        </label>
      </div>
      <SliderCaptcha resetKey={sliderKey} onTicket={setTicket} />
      {msg && <p className="ok-text">{msg}</p>}
      <button className="btn btn-primary btn-block" onClick={() => void bind()}>确认{user.email ? "换绑" : "绑定"}</button>
    </Modal>
  );
}

function ChangePwModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pwCode, setPwCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwTicket, setPwTicket] = useState("");
  const [pwSliderKey, setPwSliderKey] = useState(0);
  const [pwLeft, setPwLeft] = useState(0);
  const [pwMsg, setPwMsg] = useState("");
  useEffect(() => { const t = pwLeft > 0 ? setTimeout(() => setPwLeft(pwLeft - 1), 1000) : undefined; return () => clearTimeout(t); }, [pwLeft]);
  const sendPwCode = async () => {
    if (!pwTicket) { setPwMsg("请先完成滑块验证"); return; }
    try { const d = await api.post<{ emailMasked: string }>("/api/me/send-changepw-code", { ticket: pwTicket }); setPwLeft(60); setPwTicket(""); setPwSliderKey((k) => k + 1); setPwMsg(`验证码已发送至 ${d.emailMasked}`); }
    catch (e) { setPwMsg((e as Error).message); }
  };
  const changePw = async () => {
    try { await api.post("/api/me/change-password", { code: pwCode.trim(), newPassword: newPw }); setPwMsg("密码已修改，其他设备需重新登录"); onDone(); }
    catch (e) { setPwMsg((e as Error).message); }
  };
  return (
    <Modal title="修改密码" onClose={onClose}>
      <p className="muted tiny">通过邮箱验证码修改，不需要记得原密码。</p>
      <div className="form">
        <label>邮箱验证码
          <span className="code-row">
            <input value={pwCode} onChange={(e) => setPwCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
            <CodeBox onSend={() => void sendPwCode()} busy={false} left={pwLeft} label="发送验证码" />
          </span>
        </label>
        <label>新密码<input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="至少 6 位" /></label>
      </div>
      <SliderCaptcha resetKey={pwSliderKey} onTicket={setPwTicket} />
      {pwMsg && <p className="ok-text">{pwMsg}</p>}
      <button className="btn btn-primary btn-block" onClick={() => void changePw()}>修改密码</button>
    </Modal>
  );
}

function SecurityTab({ user, refreshUser }: { user: UserInfo; refreshUser: () => void }) {
  const [dialog, setDialog] = useState<"bind" | "pw" | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const loadSessions = useCallback(() => {
    api.get<{ sessions: SessionRow[] }>("/api/me/sessions").then((d) => setSessions(d.sessions)).catch(() => setSessions([]));
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const revoke = async (id: number) => { await api.del(`/api/me/sessions/${id}`); loadSessions(); };
  const killOthers = async () => { await api.post("/api/me/sessions/others"); loadSessions(); };

  return (
    <div className="stack">
      <div className="panel">
        <h3>账号安全</h3>
        <div className="session-row">
          <div>
            <strong>邮箱</strong>
            <div className="muted tiny">{user.email ? `当前邮箱：${user.email}` : "尚未绑定邮箱"}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setDialog("bind")}>{user.email ? "换绑邮箱" : "绑定邮箱"}</button>
        </div>
        <div className="session-row">
          <div>
            <strong>密码</strong>
            <div className="muted tiny">通过邮箱验证码修改，不需要记得原密码</div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={!user.email} title={user.email ? "" : "请先绑定邮箱"} onClick={() => setDialog("pw")}>修改密码</button>
        </div>
      </div>

      <div className="panel">
        <h3>登录会话</h3>
        {sessions.length === 0 && <p className="muted tiny">暂无会话记录</p>}
        {sessions.map((s) => (
          <div key={s.id} className="session-row">
            <div>
              <div>{s.current ? <span className="badge badge-pin">当前设备</span> : null} {fmtTime(s.created_at)}</div>
              <div className="muted tiny">{s.ip} · {s.ua.slice(0, 80)}</div>
            </div>
            {!s.current && <button className="btn btn-ghost btn-sm" onClick={() => void revoke(s.id)}>下线</button>}
          </div>
        ))}
        {sessions.length > 1 && <button className="btn btn-ghost" onClick={() => void killOthers()}>下线其他全部设备</button>}
      </div>
      {dialog === "bind" && <BindEmailModal user={user} onClose={() => setDialog(null)} onDone={refreshUser} />}
      {dialog === "pw" && <ChangePwModal onClose={() => setDialog(null)} onDone={loadSessions} />}
    </div>
  );
}

function MyNotesTab({ onEditNote, onOpenNote }: { onEditNote: (n: NoteInfo) => void; onOpenNote: (n: NoteInfo) => void }) {
  const [filter, setFilter] = useState("all");
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [lb, setLb] = useState<{ images: string[]; index: number } | null>(null);
  const [shareNote, setShareNote] = useState<NoteInfo | null>(null);
  const load = useCallback(() => {
    api.get<{ notes: NoteInfo[] }>(`/api/me/notes?filter=${filter}`).then((d) => setNotes(d.notes)).catch(() => setNotes([]));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (n: NoteInfo, patch: Partial<NoteInfo>) => {
    await api.put(`/api/notes/${n.id}`, { ...n, ...patch });
    load();
  };
  const del = async (n: NoteInfo) => {
    if (!confirm("确定删除这篇笔记？")) return;
    await api.del(`/api/notes/${n.id}`);
    load();
  };
  return (
    <div className="panel">
      <h3>我的独白</h3>
      <div className="seg">
        {[["all", "全部"], ["public", "公开"], ["private", "私密"], ["archived", "归档"]].map(([k, label]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {notes.length === 0 && <p className="muted tiny">暂无笔记</p>}
      {notes.map((n) => (
        <div key={n.id} className="my-note-item">
          <div className="my-note-head">
            {n.title && (
              <button className="my-note-title" onClick={() => onOpenNote(n)}>
                {n.title}
              </button>
            )}
            {n.tags.length > 1 && (
              <span className="head-tags">{n.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</span>
            )}
            {n.pinned && <span className="badge badge-pin">置顶</span>}
            <span className="badge">{n.archived ? "归档" : n.visibility === "private" ? "私密" : "公开"}</span>
            <span className="muted tiny">{fmtTime(n.createdAt)}</span>
            {n.tags.length === 1 && <span className="chip head-tag-right">#{n.tags[0]}</span>}
          </div>
          <div className="my-note-preview markdown"
            onClick={(e) => { const hit = imageHit(e); if (hit) { setLb(hit); return; } onOpenNote(n); }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content) }} />
          <div className="foot-split">
            {(n.weather || n.location) && (
              <span className="foot-env">
                {n.weather && <WeatherBadge text={n.weather} />}
                {n.location && <LocationBadge text={n.location} />}
              </span>
            )}
            <span className="foot-acts">
              <button className="btn btn-ghost btn-sm" onClick={() => onEditNote(n)}>编辑</button>
            {n.visibility === "private"
              ? <button className="btn btn-ghost btn-sm" onClick={() => void toggle(n, { visibility: "public" })}>设为公开</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => void toggle(n, { visibility: "private" })}>设为私密</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => void toggle(n, { archived: !n.archived })}>{n.archived ? "取消归档" : "归档"}</button>
            <button type="button" className="act-btn" aria-label="分享" title="分享" onClick={() => setShareNote(n)}><PlaneIcon /></button>
            <button className="btn btn-danger btn-sm" onClick={() => void del(n)}>删除</button>
            </span>
          </div>
        </div>
      ))}
      {lb && <Lightbox images={lb.images} index={lb.index} onClose={() => setLb(null)} />}
      {shareNote && <ShareDialog note={shareNote} onClose={() => setShareNote(null)} />}
    </div>
  );
}

function AccountsTab({ site }: { site: SiteInfo }) {
  const [bound, setBound] = useState<Binding[]>([]);
  const load = useCallback(() => {
    api.get<{ bound: Binding[] }>("/api/me/oauth").then((d) => setBound(d.bound)).catch(() => setBound([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const providers = [{ key: "github", label: "GitHub" }, { key: "qq", label: "QQ" }];
  const unbind = async (p: string) => {
    if (!confirm(`解绑 ${p === "github" ? "GitHub" : "QQ"} 账号？`)) return;
    try { await api.del(`/api/me/oauth/${p}`); load(); } catch (e) { alert((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3>第三方账号绑定</h3>
      {providers.map(({ key, label }) => {
        const b = bound.find((x) => x.provider === key);
        const enabled = site.oauthProviders.includes(key);
        return (
          <div key={key} className="session-row">
            <div>
              <strong>{label}</strong>
              <div className="muted tiny">{b ? `已绑定：${b.provider_nickname || "第三方账号"}（${fmtTime(b.created_at)}）` : enabled ? "未绑定" : "未绑定（管理员尚未启用该登录方式）"}</div>
            </div>
            {b
              ? <button className="btn btn-ghost btn-sm" onClick={() => void unbind(key)}>解绑</button>
              : enabled ? <a className="btn btn-ghost btn-sm" href={`/api/auth/oauth/${key}/start?bind=1`}>绑定</a> : null}
          </div>
        );
      })}
    </div>
  );
}

// 保持导出签名简洁
export type { SessionRow };
