import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { excerpt, firstImage } from "./md";

export function Avatar({ url, name, size = 36 }: { url: string; name: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(12, size * 0.42) };
  if (url) return <img className="avatar" style={style} src={url} alt={name} />;
  return <span className="avatar avatar-fallback" style={style}>{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-panel${wide ? " modal-wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- 滑块拼图验证 ----------
const SW = 320, SH = 160, SP = 44;
export function SliderCaptcha({ onTicket, resetKey }: { onTicket: (t: string) => void; resetKey: number }) {
  const [ch, setCh] = useState<{ id: string; bg: string; piece: string; y: number } | null>(null);
  const [x, setX] = useState(0);
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; base: number } | null>(null);

  const load = useCallback(async () => {
    setX(0); setState("idle"); setMsg("");
    try {
      const d = await api.get<{ id: string; bg: string; piece: string; y: number }>("/api/auth/slider");
      setCh(d);
    } catch { setMsg("验证图加载失败，请刷新"); }
  }, []);
  useEffect(() => { void load(); }, [load, resetKey]);

  const dispW = () => wrapRef.current?.clientWidth || SW;
  const scale = () => dispW() / SW;
  const maxX = () => dispW() - SP * scale();

  const submit = async (dispX: number) => {
    if (!ch) return;
    try {
      const d = await api.post<{ ticket: string }>("/api/auth/slider/verify", { challengeId: ch.id, x: Math.round(dispX / scale()) });
      setState("ok"); setMsg("验证通过");
      onTicket(d.ticket);
    } catch (e) {
      setState("err"); setMsg((e as Error).message);
      setTimeout(() => void load(), 700);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (state === "ok") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, base: x };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = Math.min(maxX(), Math.max(0, drag.current.base + (e.clientX - drag.current.startX)));
    setX(nx);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (x > 4) void submit(x);
  };

  const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="slider-wrap" ref={wrapRef}>
      <div className="slider-stage" style={{ aspectRatio: `${SW}/${SH}` }}>
        {ch && <img className="slider-bg" src={uri(ch.bg)} alt="滑块背景" draggable={false} />}
        {ch && <img className="slider-piece" src={uri(ch.piece)} alt="滑块" draggable={false}
          style={{ left: x, width: SP * scale(), top: `${((ch?.y ?? 46) / SH) * 100}%` }} />}
        {state === "ok" && <div className="slider-ok">✓ 验证通过</div>}
      </div>
      <div className="slider-track"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className="slider-fill" style={{ width: x + SP * scale() / 2 }} />
        <div className="slider-handle" style={{ left: x }} title="拖动滑块">⇄</div>
        <span className="slider-hint">{state === "ok" ? "已验证" : "拖动滑块完成拼图"}</span>
      </div>
      <div className="slider-foot">
        <span className={state === "err" ? "err-text" : "muted tiny"}>{msg}</span>
        <button type="button" className="text-btn" onClick={() => void load()}>刷新验证图</button>
      </div>
    </div>
  );
}

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, start: () => setLeft(60) };
}

// ---------- 登录 / 注册 / 忘记密码弹窗 ----------
export function AuthDialog({ site, onClose, onAuthed }: { site: SiteInfo; onClose: () => void; onAuthed: (u: UserInfo) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [ticket, setTicket] = useState("");
  const [sliderKey, setSliderKey] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const cd = useCountdown();

  const freshSlider = () => { setTicket(""); setSliderKey((k) => k + 1); };
  const needTicket = () => {
    if (!ticket) { setError("请先完成滑块验证"); return false; }
    return true;
  };
  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); freshSlider(); } finally { setBusy(false); }
  };

  const sendCode = (purpose: "register" | "reset") => {
    if (!needTicket()) return;
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError("请先填写正确的邮箱"); return; }
    void wrap(async () => {
      await api.post("/api/auth/send-code", { email: em, purpose, ticket });
      cd.start(); freshSlider();
      setError("");
    });
  };

  const submit = () => {
    if (!needTicket()) return;
    if (mode === "login") {
      void wrap(async () => {
        const d = await api.post<{ user: UserInfo }>("/api/auth/login", { account: account.trim(), password, ticket });
        onAuthed(d.user); onClose();
      });
    } else if (mode === "register") {
      void wrap(async () => {
        const d = await api.post<{ user: UserInfo }>("/api/auth/register", { username: username.trim(), email: email.trim(), code: code.trim(), password, ticket });
        onAuthed(d.user); onClose();
      });
    } else {
      void wrap(async () => {
        await api.post("/api/auth/reset-password", { email: email.trim(), code: code.trim(), password, ticket });
        setMode("login"); setPassword(""); freshSlider();
        setError("密码已重置，请用新密码登录");
      });
    }
  };

  const oauthName = (p: string) => (p === "github" ? "GitHub" : p === "qq" ? "QQ" : p);
  return (
    <Modal title={mode === "login" ? "登录" : mode === "register" ? "注册" : "忘记密码"} onClose={onClose}>
      <div className="seg" role="tablist">
        <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); freshSlider(); setError(""); }}>登录</button>
        {site.registerOpen && <button className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); freshSlider(); setError(""); }}>注册</button>}
        <button className={mode === "reset" ? "on" : ""} onClick={() => { setMode("reset"); freshSlider(); setError(""); }}>忘记密码</button>
      </div>

      {mode === "login" && (
        <div className="form">
          <label>用户名或邮箱<input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="用户名或邮箱" autoComplete="username" /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" autoComplete="current-password" /></label>
        </div>
      )}
      {mode === "register" && (
        <div className="form">
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="2-24 位，字母/数字/下划线/中文" autoComplete="username" /></label>
          <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="用于接收验证码" autoComplete="email" /></label>
          <label>邮箱验证码
            <span className="code-row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
              <button type="button" className="btn btn-ghost" disabled={cd.left > 0 || busy} onClick={() => sendCode("register")}>{cd.left > 0 ? `${cd.left}s` : "发送验证码"}</button>
            </span>
          </label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" autoComplete="new-password" /></label>
        </div>
      )}
      {mode === "reset" && (
        <div className="form">
          <label>绑定邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="注册时绑定的邮箱" autoComplete="email" /></label>
          <label>邮箱验证码
            <span className="code-row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" inputMode="numeric" />
              <button type="button" className="btn btn-ghost" disabled={cd.left > 0 || busy} onClick={() => sendCode("reset")}>{cd.left > 0 ? `${cd.left}s` : "发送验证码"}</button>
            </span>
          </label>
          <label>新密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" autoComplete="new-password" /></label>
        </div>
      )}

      <SliderCaptcha resetKey={sliderKey} onTicket={setTicket} />
      {error && <p className={error.includes("已重置") ? "ok-text" : "err-text"}>{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
        {busy ? "处理中…" : mode === "login" ? "登录" : mode === "register" ? "注册并登录" : "重置密码"}
      </button>

      {site.oauthProviders.length > 0 && (
        <div className="oauth-area">
          <div className="oauth-divider"><span>第三方登录</span></div>
          <div className="oauth-btns">
            {site.oauthProviders.map((p) => (
              <a key={p} className="btn btn-ghost" href={`/api/auth/oauth/${p}/start`}>使用 {oauthName(p)} 登录</a>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- 标签输入 ----------
export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (t: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const v = t.trim().slice(0, 24);
    if (v && !value.includes(v) && value.length < 10) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="tag-input">
      <div className="tag-chips">
        {value.map((t) => (
          <span key={t} className="chip chip-on">#{t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`删除标签 ${t}`}>✕</button></span>
        ))}
        <input value={draft} placeholder="输入标签回车添加" list="tag-suggest"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }}
          onBlur={() => draft && add(draft)} />
        <datalist id="tag-suggest">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  );
}

// ---------- 笔记卡片 ----------
export function NoteCard({ note, onOpen }: { note: NoteInfo; onOpen: (n: NoteInfo) => void }) {
  const img = firstImage(note.content);
  return (
    <article className="note-card" onClick={() => onOpen(note)}>
      <header>
        {note.author && <Avatar url={note.author.avatar} name={note.author.nickname} size={34} />}
        <div className="note-meta">
          <strong>{note.author?.nickname || "用户"}</strong>
          <span className="muted tiny">@{note.author?.username} · {fmtTime(note.createdAt)}</span>
        </div>
        {note.pinned && <span className="badge badge-pin">置顶</span>}
        {note.visibility === "private" && <span className="badge">私密</span>}
        {note.archived && <span className="badge">归档</span>}
      </header>
      {(note.weather || note.location) && (
        <div className="note-env">
          {note.weather && <span>🌤 {note.weather}</span>}
          {note.location && <span>📍 {note.location}</span>}
        </div>
      )}
      {note.title && <h3>{note.title}</h3>}
      <p className="note-excerpt">{excerpt(note.content)}</p>
      {img && <img className="note-thumb" src={img} alt="" loading="lazy" />}
      {note.tags.length > 0 && <div className="tag-row">{note.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div>}
    </article>
  );
}
