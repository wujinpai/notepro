import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, fmtTime, type NoteInfo, type SiteInfo, type UserInfo } from "./api";
import { excerpt, imagesOf, renderMarkdownTextOnly } from "./md";
import { isSameOriginUrl, proxyImageUrl } from "./poster-util";
import { renderPoster, loadBitmap, type PosterAssets } from "./poster-canvas";

// ---------- 扁平线条图标（stroke=currentColor，全站统一） ----------
const line = {
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

export function SunIcon() {
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

export function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function PenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

export function BubbleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function PlaneIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

// ---------- 天气图标（扁平线条，与全站图标同口径） ----------
const CLOUD = "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z";

export function SunIcon18() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export function PartlyCloudyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <circle cx="7.5" cy="7.5" r="2.6" />
      <path d="M7.5 2.8v1.3M2.8 7.5h1.3M4.2 4.2l.9.9" />
      <g transform="translate(7.8 9.3) scale(0.66)">
        <path d={CLOUD} />
      </g>
    </svg>
  );
}

export function OvercastIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d={CLOUD} />
    </svg>
  );
}

export function RainIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <g transform="translate(0 -2.5)">
        <path d={CLOUD} />
      </g>
      <path d="M8 18.5v2.5M12 17.5v2.5M16 18.5v2.5" />
    </svg>
  );
}

export function SnowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <g transform="translate(0 -2.5)">
        <path d={CLOUD} />
      </g>
      <path d="M8 19h.01M12 21h.01M16 19h.01" />
    </svg>
  );
}

export function FogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <path d="M5 8h14M3 12h14M5 16h14M7 20h10" />
    </svg>
  );
}

export function StormIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...line}>
      <g transform="translate(0 -2.5)">
        <path d={CLOUD} />
      </g>
      <path d="M13.5 14.5 9.5 20.5h5l-1.8 3.2" />
    </svg>
  );
}

// 按天气文本关键词选图标：雷 > 雪 > 雾/霾 > 雨 > 阴 > 晴 > 云，都不中默认多云
function weatherKind(text: string): "sun" | "partly" | "overcast" | "rain" | "snow" | "fog" | "storm" {
  if (/雷/.test(text)) return "storm";
  if (/雪|冰雹/.test(text)) return "snow";
  if (/雾|霾/.test(text)) return "fog";
  if (/雨/.test(text)) return "rain";
  if (/阴/.test(text)) return "overcast";
  if (/晴/.test(text)) return "sun";
  if (/云/.test(text)) return "partly";
  return "partly";
}

// 天气徽标：只显示图标，原始完整文本放 title/aria-label（悬停可看）
export function WeatherBadge({ text }: { text: string }) {
  const k = weatherKind(text);
  const icon =
    k === "sun" ? <SunIcon18 /> :
    k === "overcast" ? <OvercastIcon /> :
    k === "rain" ? <RainIcon /> :
    k === "snow" ? <SnowIcon /> :
    k === "fog" ? <FogIcon /> :
    k === "storm" ? <StormIcon /> : <PartlyCloudyIcon />;
  return <span className="env-wx" data-wx={k} title={text} aria-label={text} role="img">{icon}</span>;
}

// 位置徽标：扁平定位图标 + 文字
export function LocationBadge({ text }: { text: string }) {
  return <span className="env-loc" title={text}><PinIcon />{text}</span>;
}

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
// SW/SH：挑战生成坐标系（服务端口径）；SHD：前端展示高度（压扁），拼图块等比压扁以贴合背景凹槽
const SW = 320, SH = 160, SHD = 120, SP = 44;
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
      <div className="slider-stage" style={{ aspectRatio: `${SW}/${SHD}` }}>
        {ch && <img className="slider-bg" src={uri(ch.bg)} alt="滑块背景" draggable={false} />}
        {ch && <img className="slider-piece" src={uri(ch.piece)} alt="滑块" draggable={false}
          style={{ left: x, width: SP * scale(), height: SP * scale() * (SHD / SH), top: `${((ch?.y ?? 46) / SH) * 100}%` }} />}
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
  const [inviteCode, setInviteCode] = useState("");
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
        const d = await api.post<{ user: UserInfo }>("/api/auth/register", { username: username.trim(), email: email.trim(), code: code.trim(), password, ticket, inviteCode: inviteCode.trim() });
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
      <div className="seg seg-fill" role="tablist">
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
          {site.inviteOnly && (
            <label>邀请码<input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="请输入邀请码" autoComplete="off" /></label>
          )}
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

// ---------- 分享弹窗：链接 + 卡片海报（含右下角二维码） + 保存图片 ----------
export interface ShareInfo { token: string; url: string; isAuthor: boolean }
export function ShareDialog({ note, brand, onClose }: { note: NoteInfo; brand?: string; onClose: () => void }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [qr, setQr] = useState("");
  const [posterPng, setPosterPng] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [genKey, setGenKey] = useState(0); // 递增 → 重新生成海报
  const [genState, setGenState] = useState<"idle" | "working" | "done" | "fail">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    api.get<ShareInfo>(`/api/notes/${note.id}/share`)
      .then((d) => { if (!dead) setInfo(d); })
      .catch((e) => { if (!dead) setError((e as Error).message); });
    return () => { dead = true; };
  }, [note.id]);

  useEffect(() => {
    if (!info) { setQr(""); return; }
    QRCode.toDataURL(info.url, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [info]);

  // 海报生成：Canvas 手绘，不依赖 html-to-image 的 SVG foreignObject，
  // 在 iOS Safari / 微信 WebView / 桌面 Chrome 表现一致。
  // 图片经 fetch 取字节（外链走服务端代理转同源），失败的图直接剔除不留占位。
  useEffect(() => {
    if (!qr) return;
    let dead = false;
    setGenState("working"); setPosterPng(""); setSaveMsg("");
    const sameUrl = (s: string) => (isSameOriginUrl(s) ? s : proxyImageUrl(s));
    (async () => {
      try {
        const imgUrls = imagesOf(note.content).slice(0, 9).map(sameUrl);
        const rawAvatar = note.author?.avatar || "";
        const qrP = loadBitmap(qr);
        const avP = rawAvatar ? loadBitmap(sameUrl(rawAvatar)) : Promise.resolve(null);
        const imgPs = imgUrls.map((u) => loadBitmap(u));
        const [qrBmp, avBmp, ...imgBmps] = await Promise.all([qrP, avP, ...imgPs]);
        if (dead) return;
        const assets: PosterAssets = {
          images: imgBmps.filter((b): b is ImageBitmap | HTMLImageElement => !!b),
          avatar: avBmp,
          qr: qrBmp,
        };
        const url = await renderPoster(
          {
            title: note.title, content: note.content, tags: note.tags,
            weather: note.weather, location: note.location, createdAt: note.createdAt,
            author: note.author ? { nickname: note.author.nickname, username: note.author.username, avatar: note.author.avatar } : null,
          },
          brand || "",
          assets
        );
        if (dead) return;
        // 空白检测：抽样像素方差，过低视为生成失败
        let blank = false;
        try {
          const chk = await loadBitmap(url, 5000);
          if (chk) {
            const c = document.createElement("canvas");
            c.width = 32; c.height = 32;
            const cx = c.getContext("2d", { willReadFrequently: true });
            if (cx) {
              const iw = (chk as ImageBitmap).width || 32, ih = (chk as ImageBitmap).height || 32;
              cx.drawImage(chk, 0, 0, iw, ih, 0, 0, 32, 32);
              const d = cx.getImageData(0, 0, 32, 32).data;
              let diff = 0;
              for (let i = 0; i < d.length; i += 32) diff += Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]);
              blank = diff < 2000;
            }
            if ("close" in chk) (chk as ImageBitmap).close();
          }
        } catch { /* 检测失败则视为非空白 */ }
        if (blank) throw new Error("poster-blank");
        setPosterPng(url); setGenState("done");
      } catch {
        if (!dead) setGenState("fail");
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, genKey]);

  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.url); }
    catch { inputRef.current?.select(); document.execCommand?.("copy"); }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const reset = async () => {
    if (!confirm("重置后，旧的分享链接将立即失效。确定重置？")) return;
    setBusy(true); setError("");
    try {
      const d = await api.post<ShareInfo>(`/api/notes/${note.id}/share/reset`);
      setInfo(d); setCopied(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const savePoster = async () => {
    if (!posterPng || saveBusy) return;
    setSaveBusy(true); setSaveMsg("");
    try {
      const blob = await (await fetch(posterPng)).blob();
      const file = new File([blob], `note-${note.id}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[] }) => Promise<void> };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share?.({ files: [file] });
        return;
      }
      throw new Error("no-share");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // 用户取消了系统分享
      try {
        const a = document.createElement("a");
        a.href = posterPng; a.download = `note-${note.id}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setSaveMsg("已开始下载");
      } catch {
        window.open(posterPng, "_blank");
        setSaveMsg("已在新标签页打开，长按图片保存");
      }
    } finally {
      setSaveBusy(false);
    }
  };

  const regen = () => setGenKey((k) => k + 1);

  return (
    <Modal title="分享" onClose={onClose}>
      {error && <p className="err-text">{error}</p>}
      {!info && !error && <p className="muted">正在生成分享链接…</p>}
      {info && (
        <>
          <div className="share-poster-wrap">
            {genState === "done" && posterPng ? (
              <img className="share-poster-preview" src={posterPng} alt="分享海报预览" />
            ) : genState === "fail" ? (
              <div className="share-poster-fail" role="alert">
                <p>海报生成失败</p>
                <button type="button" className="btn btn-ghost" onClick={regen}>重新生成</button>
              </div>
            ) : (
              <div className="share-poster-loading" role="status">海报生成中…<br /><span className="muted tiny">图片较多或较大时需多等一会儿</span></div>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-block"
            disabled={saveBusy || (genState !== "done" && genState !== "fail")}
            onClick={() => { if (genState === "fail") regen(); else void savePoster(); }}>
            {saveBusy ? "保存中…" : genState === "fail" ? "重新生成" : genState === "done" ? "保存图片" : "生成中…"}
          </button>
          {saveMsg && <p className="ok-text">{saveMsg}</p>}
          <div className="share-link-row">
            <input ref={inputRef} readOnly value={info.url} aria-label="分享链接" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-ghost" onClick={() => void copy()}>{copied ? "已复制" : "复制"}</button>
          </div>
          <div className="share-foot-row">
            <span className="muted tiny">任何人凭此链接可查看{note.visibility === "private" ? "这篇私密独白" : "这篇独白"}</span>
            {info.isAuthor && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void reset()}>重置链接</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- 标签输入 ----------
export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (t: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const add = (t: string) => {
    const v = t.trim().slice(0, 24);
    if (v && !value.includes(v) && value.length < 10) onChange([...value, v]);
    setDraft("");
  };
  const addRef = useRef(add);
  addRef.current = add;
  // 已有标签：排除已选；输入文字时按关键字过滤；空输入时展开全部
  const kw = draft.trim();
  const shown = suggestions.filter((s) => !value.includes(s) && (!kw || s.includes(kw)));
  // 点外部关闭（顺手提交草稿，沿用旧版失焦即添加的口径）；Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        const v = (wrapRef.current?.querySelector("input") as HTMLInputElement | null)?.value.trim() || "";
        if (v) addRef.current(v);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open ]);
  return (
    <div className="tag-input" ref={wrapRef}>
      <div className="tag-chips">
        {value.map((t) => (
          <span key={t} className="chip chip-on">#{t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`删除标签 ${t}`}>✕</button></span>
        ))}
        <input value={draft} placeholder="点击选择或输入标签，回车添加"
          role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-autocomplete="list"
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(draft); }
            else if (e.key === "Escape") setOpen(false);
          }} />
      </div>
      {open && shown.length > 0 && (
        <ul className="tag-drop" role="listbox" aria-label="已有标签">
          {shown.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>#{s}</button>
            </li>
          ))}
        </ul>
      )}
      {open && shown.length === 0 && (
        <div className="tag-drop tag-drop-empty muted tiny" aria-hidden="true">
          {kw ? `无匹配标签，回车可新建「${kw.slice(0, 24)}」` : "还没有可用标签，直接输入回车新建"}
        </div>
      )}
    </div>
  );
}

// ---------- 大图预览（Lightbox） ----------
export function Lightbox({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [cur, setCur] = useState(index);
  useEffect(() => { setCur(index); }, [index]);
  const go = useCallback((d: number) => setCur((c) => (c + d + images.length) % images.length), [images.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [go, onClose]);
  if (!images.length) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="图片预览">
      <button type="button" className="lb-btn lb-close" aria-label="关闭" onClick={onClose}>✕</button>
      {images.length > 1 && <button type="button" className="lb-btn lb-prev" aria-label="上一张" onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>}
      <img className="lb-img" src={images[cur]} alt="" onClick={(e) => e.stopPropagation()} />
      {images.length > 1 && <button type="button" className="lb-btn lb-next" aria-label="下一张" onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>}
      {images.length > 1 && <div className="lb-count">{cur + 1} / {images.length}</div>}
    </div>
  );
}

// 渲染区点击命中图片：返回该容器内全部图片与被点序号（未命中返回 null）
export function imageHit(e: React.MouseEvent): { images: string[]; index: number } | null {
  const t = e.target as HTMLElement;
  if (t.tagName !== "IMG") return null;
  const root = e.currentTarget as HTMLElement;
  const srcs = Array.from(root.querySelectorAll("img")).map((im) => (im as HTMLImageElement).src);
  const idx = srcs.indexOf((t as HTMLImageElement).src);
  return idx >= 0 ? { images: srcs, index: idx } : null;
}

// ---------- 笔记卡片 ----------
export function NoteCard({ note, onOpen, onComment, onTag }: {
  note: NoteInfo; onOpen: (n: NoteInfo) => void; onComment: (n: NoteInfo) => void; onTag?: (t: string) => void;
}) {
  const imgs = imagesOf(note.content);
  const [lb, setLb] = useState<{ images: string[]; index: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pickTag = (e: { stopPropagation(): void }, t: string) => { e.stopPropagation(); onTag?.(t); };
  const bodyHtml = renderMarkdownTextOnly(note.content);
  // 内容较长时折叠：去掉 Markdown 标记后的纯文本超 600 字或超 10 行才折叠
  const plainLen = (note.content || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, "").length;
  const lineCount = (note.content || "").split(/\n/).length;
  const longBody = bodyHtml && (plainLen > 600 || lineCount > 10);
  return (
    <>
    <article className="note-card">
      <header>
        {note.author && <Avatar url={note.author.avatar} name={note.author.nickname} size={34} />}
        <div className="note-meta">
          <span className="note-meta-top">
            <strong>{note.author?.nickname || "用户"}</strong>
            {note.tags.length > 1 && (
              <span className="head-tags">
                {note.tags.map((t) => (
                  <button key={t} type="button" className="chip" title={`按标签 #${t} 筛选`}
                    onClick={(e) => pickTag(e, t)}>#{t}</button>
                ))}
              </span>
            )}
          </span>
          <span className="muted tiny">@{note.author?.username} · {fmtTime(note.createdAt)}</span>
        </div>
        {note.pinned && <span className="badge badge-pin">置顶</span>}
        {note.visibility === "private" && <span className="badge">私密</span>}
        {note.archived && <span className="badge">归档</span>}
        {note.tags.length === 1 && (
          <button type="button" className="chip head-tag-right" title={`按标签 #${note.tags[0]} 筛选`}
            onClick={(e) => pickTag(e, note.tags[0])}>#{note.tags[0]}</button>
        )}
      </header>
      {note.title && <h3>{note.title}</h3>}
      {bodyHtml && (
        <div className={`note-body ${longBody && !expanded ? "folded" : ""}`}
          dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}
      {longBody && (
        <button type="button" className="fold-toggle"
          onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
      {imgs.length > 0 && (
        <div className={`img-grid cols-${imgs.length === 1 ? 1 : imgs.length <= 4 ? 2 : 3}`}>
          {imgs.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy"
              onClick={(e) => { e.stopPropagation(); setLb({ images: imgs, index: i }); }} />
          ))}
        </div>
      )}
      <div className="note-card-foot">
        {(note.weather || note.location) && (
          <span className="foot-env">
            {note.weather && <WeatherBadge text={note.weather} />}
            {note.location && <LocationBadge text={note.location} />}
          </span>
        )}
        <span className="foot-acts">
          {note.allowComments && (
            <button type="button" className="act-btn" aria-label={`评论（${note.commentCount} 条）`} title="评论"
              onClick={(e) => { e.stopPropagation(); onComment(note); }}>
              <BubbleIcon /><span className="act-count">{note.commentCount}</span>
            </button>
          )}
          <button type="button" className="act-btn share-act" aria-label="分享" title="分享"
            onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}><PlaneIcon /></button>
        </span>
      </div>
    </article>
    {lb && <Lightbox images={lb.images} index={lb.index} onClose={() => setLb(null)} />}
    {shareOpen && <ShareDialog note={note} onClose={() => setShareOpen(false)} />}
    </>
  );
}
