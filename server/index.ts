import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, unlinkSync, copyFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db, getSetting, setSetting, DATA_DIR, DB_PATH } from "./db.js";
import { hashPassword, verifyPassword, sha256, encryptSecret, decryptSecret, verifyPayload, signPayload, maskEmail, randomToken, parseTencentAddressComponent, normalizeQweatherHost } from "./util.js";
import { sendEmailCode, verifyEmailCode, createSliderChallenge, verifySlider, consumeTicket, getSmtpConfig, sendMail } from "./mail.js";
import {
  getUserById, getUserByUsername, getUserByEmail, publicUser, createSession, setSessionCookie, clearSessionCookie,
  getSessionUser, destroySession, destroyOtherSessions, destroyAllSessions, requireAuth, requireAdmin, authedUser, rateLimit, parseCookies,
} from "./auth.js";
import type { UserRow } from "./auth.js";
import { PROVIDERS, getProviderConfig, saveProviderConfig, authorizeUrl, exchangeProfile } from "./oauth.js";
import type { Provider } from "./oauth.js";
import { assertProxyTarget, fetchProxyImage, ProxyImageError, PROXY_TIMEOUT_MS } from "./proxy-image.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const STORAGE_DIR = process.env.STORAGE_DIR || join(process.cwd(), "storage");
const IMG_DIR = join(STORAGE_DIR, "images");
mkdirSync(IMG_DIR, { recursive: true });

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(STORAGE_DIR, { maxAge: "7d" }));

// 访客记录（对标参考程序的访客统计，仅记前台数据请求）
app.use((req, _res, next) => {
  if (req.method === "GET" && (req.path === "/api/notes" || req.path === "/api/site")) {
    try {
      db.prepare("INSERT INTO visits(ip,ua,path,created_at) VALUES(?,?,?,?)")
        .run(req.ip || "", String(req.headers["user-agent"] || "").slice(0, 160), req.path, Date.now());
    } catch { /* ignore */ }
  }
  next();
});

const ok = (res: Response, data: unknown = {}) => res.json({ ok: true, ...(data as object) });
const fail = (res: Response, status: number, error: string) => res.status(status).json({ ok: false, error });

// ---------- 站点公开信息 ----------
function siteOrigin(req: Request): string {
  const configured = getSetting("site_url");
  if (configured) return configured.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  return `${proto}://${req.headers.host}`;
}
function sitePayload() {
  const oauth: string[] = [];
  for (const p of PROVIDERS) if (getProviderConfig(p).enabled && getSetting("oauth_show_login", "1") === "1") oauth.push(p);
  return {
    name: getSetting("site_name", "己素"),
    subtitle: getSetting("site_subtitle", "Jisu"),
    description: getSetting("site_description", "己素 Jisu：多用户笔记广场，记录、分享与发现。"),
    keywords: getSetting("site_keywords", "笔记,博客,己素,Jisu"),
    footer: getSetting("site_footer", ""),
    icp: getSetting("site_icp", "黔ICP备2026016351号-1"),
    logo: getSetting("site_logo", ""),
    accent: getSetting("site_accent", ""),
    registerOpen: getSetting("site_register_open", "1") === "1",
    inviteOnly: getSetting("site_invite_only", "0") === "1",
    oauthProviders: oauth,
  };
}
app.get("/api/site", (_req, res) => ok(res, sitePayload()));

// 标签页图标：站长已在后台上传 Logo 时用 Logo，未设置时退回随包默认图标（?v=2  bust 旧缓存）
const DEFAULT_ICON = "/favicon-32.png?v=2";
const effectiveIcon = (): string => getSetting("site_logo", "") || DEFAULT_ICON;

// ---------- 滑块 ----------
app.get("/api/auth/slider", rateLimit(60, 60_000, "slider"), (_req, res) => {
  ok(res, createSliderChallenge());
});
app.post("/api/auth/slider/verify", (req, res) => {
  const { challengeId, x } = req.body || {};
  const r = verifySlider(String(challengeId || ""), Number(x));
  if (!r.ok) return fail(res, 400, r.error || "验证失败");
  ok(res, { ticket: r.ticket });
});
function needTicket(req: Request, res: Response): boolean {
  if (!consumeTicket(String(req.body?.ticket || ""))) { fail(res, 400, "滑块验证无效或已过期，请重新验证"); return false; }
  return true;
}

// ---------- 邮箱验证码发送（注册 / 找回，未登录）----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post("/api/auth/send-code", rateLimit(20, 60_000, "sendcode"), async (req, res) => {
  if (!needTicket(req, res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const purpose = String(req.body?.purpose || "");
  if (!EMAIL_RE.test(email)) return fail(res, 400, "邮箱格式不正确");
  if (purpose === "register") {
    if (getSetting("site_register_open", "1") !== "1" && Number((db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c) > 0)
      return fail(res, 403, "站点已关闭注册");
    if (getUserByEmail(email)) return fail(res, 409, "该邮箱已被注册");
    const r = await sendEmailCode(email, "register");
    return r.ok ? ok(res) : fail(res, 429, r.error || "发送失败");
  }
  if (purpose === "reset") {
    // 不泄漏账号是否存在：不存在也返回统一成功
    if (getUserByEmail(email)) {
      const r = await sendEmailCode(email, "reset");
      if (!r.ok && !r.error?.includes("过于频繁")) return fail(res, 500, r.error || "发送失败");
    }
    return ok(res);
  }
  return fail(res, 400, "验证码用途不正确");
});

// ---------- 注册 / 登录 / 找回 ----------
const USERNAME_RE = /^[A-Za-z0-9_一-龥]{2,24}$/;
app.post("/api/auth/register", rateLimit(20, 60_000, "register"), (req, res) => {
  if (!needTicket(req, res)) return;
  const username = String(req.body?.username || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const password = String(req.body?.password || "");
  if (!USERNAME_RE.test(username)) return fail(res, 400, "用户名需为 2-24 位（字母、数字、下划线或中文）");
  if (!EMAIL_RE.test(email)) return fail(res, 400, "邮箱格式不正确");
  if (password.length < 6) return fail(res, 400, "密码至少 6 位");
  if (getUserByUsername(username)) return fail(res, 409, "用户名已被占用");
  if (getUserByEmail(email)) return fail(res, 409, "该邮箱已被注册");
  if (!verifyEmailCode(email, "register", code)) return fail(res, 400, "邮箱验证码错误或已过期");
  const count = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  const role = count === 0 ? "admin" : "user";
  // 邀请码注册：开启后（且已有用户）必须提供未使用的邀请码，一个码对应一个用户
  const inviteOnly = getSetting("site_invite_only", "0") === "1" && count > 0;
  const inviteCode = String(req.body?.inviteCode || "").toUpperCase().trim();
  let user: ReturnType<typeof getUserById>;
  try {
    db.exec("BEGIN IMMEDIATE");
    if (inviteOnly) {
      if (!inviteCode) throw new Error("请填写邀请码");
      const ic = db.prepare("SELECT code FROM invite_codes WHERE code=? AND used_at IS NULL").get(inviteCode) as { code: string } | undefined;
      if (!ic) throw new Error("邀请码无效或已被使用");
    }
    const info = db.prepare("INSERT INTO users(username,email,password_hash,nickname,role,created_at) VALUES(?,?,?,?,?,?)")
      .run(username, email, hashPassword(password), username, role, Date.now());
    const uid = Number(info.lastInsertRowid);
    if (inviteOnly) {
      const r = db.prepare("UPDATE invite_codes SET used_at=?, used_by=? WHERE code=? AND used_at IS NULL").run(Date.now(), uid, inviteCode);
      if (r.changes === 0) throw new Error("邀请码已被使用");
    }
    db.exec("COMMIT");
    user = getUserById(uid)!;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    const msg = (e as Error).message;
    if (msg === "请填写邀请码" || msg === "邀请码无效或已被使用" || msg === "邀请码已被使用") return fail(res, 400, msg);
    throw e;
  }
  setSessionCookie(res, createSession(req, user.id));
  ok(res, { user: publicUser(user, true) });
});

app.post("/api/auth/login", rateLimit(30, 60_000, "login"), (req, res) => {
  if (!needTicket(req, res)) return;
  const account = String(req.body?.account || "").trim();
  const password = String(req.body?.password || "");
  const user = account.includes("@") ? getUserByEmail(account.toLowerCase()) : getUserByUsername(account);
  if (!user || !verifyPassword(password, user.password_hash)) return fail(res, 401, "账号或密码不正确");
  if (user.status !== "active") return fail(res, 403, "账号已被禁用，请联系管理员");
  setSessionCookie(res, createSession(req, user.id));
  ok(res, { user: publicUser(user, true) });
});

app.post("/api/auth/logout", (req, res) => { destroySession(req); clearSessionCookie(res); ok(res); });

app.post("/api/auth/reset-password", rateLimit(20, 60_000, "reset"), (req, res) => {
  if (!needTicket(req, res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const password = String(req.body?.password || "");
  if (password.length < 6) return fail(res, 400, "密码至少 6 位");
  const user = getUserByEmail(email);
  // 与发码口径一致：统一报错，不泄漏账号存在性
  if (!user || !verifyEmailCode(email, "reset", code)) return fail(res, 400, "邮箱验证码错误或已过期");
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(password), user.id);
  destroyAllSessions(user.id);
  ok(res);
});

app.get("/api/auth/me", (req, res) => {
  const u = getSessionUser(req);
  if (!u) return fail(res, 401, "未登录");
  ok(res, { user: publicUser(u, true) });
});

// ---------- OAuth ----------
function callbackUri(req: Request, p: Provider) {
  return `${siteOrigin(req)}/api/auth/oauth/${p}/callback`;
}

// OAuth 错误页：给可操作的中文指引（替代原来含糊的 alert 跳回首页）。
// 真实环境最常见的失败是 GitHub 回来的 error=redirect_uri_mismatch —— 把「我们实际发出去的
// redirect_uri」原样展示出来，管理员才能逐字核对平台侧的配置。
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function oauthErrorPage(res: Response, title: string, lines: string[]) {
  const name = escAttr(getSetting("site_name", "己素"));
  const body = lines.map((l) => `<p>${l}</p>`).join("");
  res.status(400).type("html").send(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title} - ${name}</title>` +
    `<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f6f3ec;color:#36332c;margin:0;padding:32px 16px}` +
    `.card{max-width:640px;margin:0 auto;background:#fffdf8;border:1px solid #e6e0cf;border-radius:12px;padding:28px 24px}` +
    `h1{font-size:19px;margin:0 0 12px}.card p{font-size:14px;line-height:1.8;margin:8px 0}` +
    `code{background:#f1ecdf;padding:2px 8px;border-radius:6px;font-size:13px;word-break:break-all}` +
    `ol{font-size:14px;line-height:2;padding-left:22px;margin:8px 0}` +
    `.home{display:inline-block;margin-top:16px;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 28px;border-radius:7px;font-size:15px}` +
    `.muted{color:#8a8375;font-size:12px}</style></head><body><div class="card"><h1>${title}</h1>${body}` +
    `<a class="home" href="/">返回首页</a></div></body></html>`
  );
}
app.get("/api/auth/oauth/:provider/start", (req, res) => {
  const p = req.params.provider as Provider;
  if (!PROVIDERS.includes(p)) return fail(res, 404, "不支持的第三方登录");
  const cfg = getProviderConfig(p);
  if (!cfg.enabled) return fail(res, 400, "该第三方登录未配置或未启用");
  const me = getSessionUser(req);
  const bind = req.query.bind === "1" && me ? me.id : 0;
  const state = signPayload({ p, bind, t: Date.now() });
  const uri = callbackUri(req, p);
  console.log(`[oauth] start provider=${p} bind=${bind} redirect_uri=${uri}`);
  res.redirect(authorizeUrl(p, cfg, uri, state));
});
app.get("/api/auth/oauth/:provider/callback", async (req, res) => {
  const p = req.params.provider as Provider;
  if (!PROVIDERS.includes(p)) return oauthErrorPage(res, "第三方登录失败", ["不支持的第三方登录。"]);
  const uri = callbackUri(req, p);
  // 平台侧直接返回的错误（如 GitHub 的 redirect_uri_mismatch）：优先处理，别再报「授权被取消」
  const perr = String(req.query.error || "");
  if (perr) {
    const desc = String(req.query.error_description || "");
    console.log(`[oauth] provider error provider=${p} error=${perr} desc=${desc.slice(0, 200)} redirect_uri=${uri}`);
    if (perr === "redirect_uri_mismatch") {
      const plat = p === "github" ? "GitHub" : "QQ 互联";
      const step1 = plat === "GitHub"
        ? "GitHub 应用 → Settings → 左侧「Authorization callback URL」，必须与上面地址<b>逐字一致</b>（注意 http/https、域名、末尾斜杠、多余空格）。"
        : "QQ 互联 → 应用管理 → 你的网站应用：①「<b>网站回调域</b>」只填域名（如 jisu.cn），必须与上面回调地址的域名一致；② 回调地址本身<b>逐字一致</b>（注意 http/https、末尾斜杠、多余空格）。";
      return oauthErrorPage(res, "第三方登录失败", [
        `${plat} 拒绝了本次登录：<b>回调地址不匹配</b>（redirect_uri_mismatch）。`,
        `我们发给 ${plat} 的回调地址是：<br><code>${escAttr(uri)}</code>`,
        `请逐字核对以下两处：<ol><li>${step1}</li>` +
        `<li>本站 管理后台 → 站点设置 →「站点地址」：留空则按访问域名推导；若反向代理未透传协议可能推导错误，可直接填写 <code>https://你的域名</code>。</li></ol>`,
        `<span class="muted">详细原因已记入服务端日志（docker logs 搜 [oauth]）。核对无误后回到登录页重新发起。</span>`,
      ]);
    }
    if (perr === "access_denied") {
      return oauthErrorPage(res, "已取消授权", ["你在平台授权页点了取消，没有完成授权。", "如需使用第三方登录，请回到登录页重新发起。"]);
    }
    const qqHint = p === "qq" && /invalid_client|100008|illegal/i.test(perr + desc)
      ? "QQ 侧认为 App ID 非法：请检查后台填的是 connect.qq.com 网站应用的<b>纯数字 App ID</b>（别带空格、别和 App Key 搞混），且应用处于可用状态。"
      : "";
    return oauthErrorPage(res, "第三方登录失败", [`平台返回错误：<code>${escAttr(perr)}</code>${desc ? `（${escAttr(desc).slice(0, 200)}）` : ""}。`, qqHint, "请回到登录页重试；多次失败请联系管理员（日志搜 [oauth]）。"].filter(Boolean));
  }
  const state = verifyPayload<{ p: string; bind: number; t: number }>(String(req.query.state || ""));
  if (!state || state.p !== p || Date.now() - state.t > 10 * 60_000) {
    console.log(`[oauth] bad state provider=${p} hasState=${!!req.query.state}`);
    return oauthErrorPage(res, "授权链接无效", ["授权链接已过期或无效（超过 10 分钟，或被重复使用）。", "请回到登录页重新发起第三方登录。"]);
  }
  const code = String(req.query.code || "");
  if (!code) return oauthErrorPage(res, "未取得授权码", ["平台没有返回授权码，可能在授权页点了取消。", "请回到登录页重试。"]);
  const cfg = getProviderConfig(p);
  if (!cfg.enabled) return oauthErrorPage(res, "第三方登录失败", ["该第三方登录未配置或未启用。"]);
  try {
    const profile = await exchangeProfile(p, cfg, code, callbackUri(req, p));
    const existing = db.prepare("SELECT user_id FROM oauth_accounts WHERE provider=? AND openid=?").get(p, profile.openid) as { user_id: number } | undefined;
    let user: UserRow | undefined;
    if (state.bind) {
      user = getUserById(state.bind);
      if (!user) return oauthErrorPage(res, "绑定失败", ["发起绑定时的登录状态已失效。", "请重新登录后再到用户中心绑定第三方账号。"]);
      if (existing && existing.user_id !== user.id) return oauthErrorPage(res, "绑定失败", ["这个第三方账号已经绑定了其他用户。", "如需换绑，请先解绑原账号。"]);
      if (!existing) {
        db.prepare("INSERT INTO oauth_accounts(user_id,provider,openid,unionid,provider_nickname,provider_avatar,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(user.id, p, profile.openid, profile.unionid, profile.nickname, profile.avatar, Date.now());
      }
      return res.redirect("/#me/accounts");
    }
    if (existing) {
      user = getUserById(existing.user_id);
      if (!user) return oauthErrorPage(res, "第三方登录失败", ["关联的用户账号不存在。"]);
    } else {
      // 自动建号：生成唯一用户名，不卡首次进入
      const base = (p === "github" ? "gh_" : "qq_") + (profile.nickname || profile.openid).replace(/[^A-Za-z0-9_一-龥]/g, "").slice(0, 16);
      let username = base || (p === "github" ? "gh_user" : "qq_user");
      let n = 1;
      while (getUserByUsername(username)) username = `${base}${n++}`;
      const count = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
      const info = db.prepare("INSERT INTO users(username,email,password_hash,nickname,avatar,signature,role,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(username, profile.email && !getUserByEmail(profile.email.toLowerCase()) ? profile.email.toLowerCase() : null, null,
          profile.nickname || username, profile.avatar || "", "", count === 0 ? "admin" : "user", Date.now());
      user = getUserById(Number(info.lastInsertRowid))!;
      db.prepare("INSERT INTO oauth_accounts(user_id,provider,openid,unionid,provider_nickname,provider_avatar,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(user.id, p, profile.openid, profile.unionid, profile.nickname, profile.avatar, Date.now());
    }
    if (user.status !== "active") return oauthErrorPage(res, "账号已被禁用", ["该账号已被管理员禁用，请联系管理员。"]);
    setSessionCookie(res, createSession(req, user.id));
    console.log(`[oauth] ok provider=${p} user=${user.id} bind=${state.bind ? 1 : 0}`);
    return res.redirect("/?oauth=ok");
  } catch (e) {
    const emsg = (e as Error).message || "第三方登录失败";
    console.log(`[oauth] callback failed provider=${p} msg=${emsg.slice(0, 300)}`);
    const net = /fetch failed|timeout|ECONN|ENOTFOUND|network/i.test(emsg);
    const netHint = () => net ? "疑似服务器无法访问平台接口，请确认服务器网络可达 " + (p === "github" ? "github.com / api.github.com。" : "graph.qq.com。") : "";
    return oauthErrorPage(res, "第三方登录失败", [`${escAttr(emsg).slice(0, 400)}。`, netHint(), "请回到登录页重试；多次失败请联系管理员（日志搜 [oauth]）。"].filter(Boolean));
  }
});

// ---------- 上传 ----------
const ALLOWED_IMG: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMG_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_IMG[file.mimetype] || "png";
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase().replace(".", "");
    if (ALLOWED_IMG[file.mimetype] && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) cb(null, true);
    else cb(new Error("仅支持 PNG/JPG/GIF/WebP 图片"));
  },
});
function handleUpload(req: Request, res: Response, kind: "note" | "avatar" | "site") {
  if (!req.file) return fail(res, 400, "未收到图片文件");
  const rel = `/uploads/images/${req.file.filename}`;
  db.prepare("INSERT INTO media(user_id,filename,path,mime,size,created_at) VALUES(?,?,?,?,?,?)")
    .run(authedUser(req).id, req.file.filename, rel, req.file.mimetype, req.file.size, Date.now());
  if (kind === "avatar") db.prepare("UPDATE users SET avatar=? WHERE id=?").run(rel, authedUser(req).id);
  if (kind === "site") setSetting("site_logo", rel);
  ok(res, { path: rel, url: rel });
}
const uploadErr = (err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  if (err) return fail(res, 400, (err as Error).message || "上传失败");
  next();
};
app.post("/api/upload", requireAuth, upload.single("file"), uploadErr, (req: Request, res: Response) => handleUpload(req, res, "note"));

// ---------- 用户中心 ----------
app.patch("/api/me/profile", requireAuth, (req, res) => {
  const u = authedUser(req);
  const nickname = String(req.body?.nickname ?? u.nickname).trim().slice(0, 32);
  const signature = String(req.body?.signature ?? u.signature).trim().slice(0, 120);
  if (!nickname) return fail(res, 400, "昵称不能为空");
  db.prepare("UPDATE users SET nickname=?, signature=? WHERE id=?").run(nickname, signature, u.id);
  ok(res, { user: publicUser(getUserById(u.id)!, true) });
});
app.post("/api/me/avatar", requireAuth, upload.single("file"), uploadErr, (req: Request, res: Response) => handleUpload(req, res, "avatar"));

app.post("/api/me/send-bind-code", requireAuth, rateLimit(20, 60_000, "bindcode"), async (req, res) => {
  if (!needTicket(req, res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(res, 400, "邮箱格式不正确");
  const other = getUserByEmail(email);
  if (other && other.id !== authedUser(req).id) return fail(res, 409, "该邮箱已被其他账号绑定");
  const r = await sendEmailCode(email, "bind");
  return r.ok ? ok(res) : fail(res, 429, r.error || "发送失败");
});
app.post("/api/me/bind-email", requireAuth, (req, res) => {
  const u = authedUser(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  if (!EMAIL_RE.test(email)) return fail(res, 400, "邮箱格式不正确");
  // 换绑/绑定不验当前密码：登录态 + 滑块票发码 + 新邮箱验证码正确即可（与改密/找回的验证码口径一致）
  const other = getUserByEmail(email);
  if (other && other.id !== u.id) return fail(res, 409, "该邮箱已被其他账号绑定");
  if (!verifyEmailCode(email, "bind", code)) return fail(res, 400, "邮箱验证码错误或已过期");
  db.prepare("UPDATE users SET email=? WHERE id=?").run(email, u.id);
  ok(res, { user: publicUser(getUserById(u.id)!, true) });
});

app.post("/api/me/send-changepw-code", requireAuth, rateLimit(20, 60_000, "changepw"), async (req, res) => {
  if (!needTicket(req, res)) return;
  const u = authedUser(req);
  if (!u.email) return fail(res, 400, "尚未绑定邮箱，请先绑定邮箱");
  const r = await sendEmailCode(u.email, "changepw");
  return r.ok ? ok(res, { emailMasked: maskEmail(u.email) }) : fail(res, 429, r.error || "发送失败");
});
app.post("/api/me/change-password", requireAuth, (req, res) => {
  const u = authedUser(req);
  const code = String(req.body?.code || "").trim();
  const password = String(req.body?.newPassword || "");
  if (!u.email) return fail(res, 400, "尚未绑定邮箱，请先绑定邮箱");
  if (password.length < 6) return fail(res, 400, "密码至少 6 位");
  if (!verifyEmailCode(u.email, "changepw", code)) return fail(res, 400, "邮箱验证码错误或已过期");
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(password), u.id);
  destroyOtherSessions(u.id, req);
  ok(res);
});

app.get("/api/me/oauth", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT provider, provider_nickname, provider_avatar, created_at FROM oauth_accounts WHERE user_id=?")
    .all(authedUser(req).id) as { provider: string }[];
  ok(res, { bound: rows });
});
app.delete("/api/me/oauth/:provider", requireAuth, (req, res) => {
  const u = authedUser(req);
  const p = req.params.provider as Provider;
  if (!PROVIDERS.includes(p)) return fail(res, 404, "不支持的第三方");
  const rows = db.prepare("SELECT COUNT(*) c FROM oauth_accounts WHERE user_id=?").get(u.id) as { c: number };
  if (!u.password_hash && rows.c <= 1) return fail(res, 400, "这是你唯一的登录方式，请先设置邮箱与密码再解绑");
  db.prepare("DELETE FROM oauth_accounts WHERE user_id=? AND provider=?").run(u.id, p);
  ok(res);
});

app.get("/api/me/sessions", requireAuth, (req, res) => {
  const token = parseCookies(req)["np_session"] || "";
  const rows = db.prepare("SELECT id, ua, ip, created_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY id DESC")
    .all(authedUser(req).id, Date.now()) as { id: number; ua: string; ip: string; created_at: number }[];
  const mine = token ? db.prepare("SELECT id FROM sessions WHERE token_hash=?").get(sha256(token)) as { id: number } | undefined : undefined;
  ok(res, { sessions: rows.map((r) => ({ ...r, current: mine?.id === r.id })) });
});
app.delete("/api/me/sessions/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").run(Number(req.params.id), authedUser(req).id);
  ok(res);
});
app.post("/api/me/sessions/others", requireAuth, (req, res) => { destroyOtherSessions(authedUser(req).id, req); ok(res); });

// ---------- 笔记 ----------
interface NoteRow {
  id: number; user_id: number; title: string; content: string; tags: string; weather: string; location: string;
  visibility: string; pinned: number; archived: number; created_at: number; updated_at: number;
  view_count: number;
  share_token: string; allow_comments: number;
}
function noteJson(n: NoteRow, withAuthor = true) {
  const author = withAuthor ? getUserById(n.user_id) : undefined;
  return {
    id: n.id, userId: n.user_id, title: n.title, content: n.content,
    tags: JSON.parse(n.tags || "[]") as string[],
    weather: n.weather, location: n.location, visibility: n.visibility,
    pinned: !!n.pinned, archived: !!n.archived, createdAt: n.created_at, updatedAt: n.updated_at,
    viewCount: n.view_count || 0,
    allowComments: n.allow_comments !== 0,
    commentCount: (db.prepare("SELECT COUNT(*) c FROM comments WHERE note_id=?").get(n.id) as { c: number }).c,
    author: author ? { id: author.id, username: author.username, nickname: author.nickname || author.username, avatar: author.avatar } : null,
  };
}
function visibleNote(req: Request, n: NoteRow): boolean {
  const author = getUserById(n.user_id);
  if (!author || author.status !== "active") return false;
  if (n.visibility === "public" && !n.archived) return true;
  const me = getSessionUser(req);
  return !!me && (me.id === n.user_id || me.role === "admin");
}

app.get("/api/notes", (req, res) => {
  const me = getSessionUser(req);
  const mine = req.query.mine === "1";
  const tag = String(req.query.tag || "");
  const q = String(req.query.q || "").trim();
  const date = String(req.query.date || "");
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(50, Math.max(1, Number(req.query.size || 20)));
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (mine) {
    if (!me) return fail(res, 401, "请先登录");
    conds.push("n.user_id=?", "n.archived=0");
    args.push(me.id);
  } else {
    conds.push("n.visibility='public'", "n.archived=0", "u.status='active'");
  }
  if (tag) { conds.push("n.tags LIKE ?"); args.push(`%"${tag}"%`); }
  if (q) { conds.push("(n.title LIKE ? OR n.content LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
  if (date) { conds.push("date(n.created_at/1000,'unixepoch','localtime')=?"); args.push(date); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) c FROM notes n JOIN users u ON u.id=n.user_id ${where}`).get(...args) as { c: number }).c;
  const rows = db.prepare(`SELECT n.* FROM notes n JOIN users u ON u.id=n.user_id ${where} ORDER BY n.pinned DESC, n.created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size) as unknown as NoteRow[];
  ok(res, { notes: rows.map((n) => noteJson(n)), total, page, size });
});
app.get("/api/notes/:id", (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || !visibleNote(req, n)) return fail(res, 404, "笔记不存在或不可见");
  // 真实渲染才计数：详情页请求带 ?view=1（编辑器等内部读取不带，不计入）
  if (req.query.view === "1") bumpViews(n.id);
  ok(res, { note: noteJson(n) });
});

// ---------- 浏览计数（只计数不追踪身份：不存 IP/UA/访客列表） ----------
// 口径：详情真实渲染一次 +1；不去重刷新与爬虫，数据仅作趋势参考
function bumpViews(noteId: number) {
  try {
    db.prepare("UPDATE notes SET view_count=view_count+1 WHERE id=?").run(noteId);
    const t = new Date();
    const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    db.prepare("INSERT INTO site_views(day,views) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET views=views+1").run(day);
  } catch { /* ignore */ }
}

// ---------- 公开独白只读（供真实路径 /n/<id> 与 sitemap；私密/归档/删除一律 404） ----------
app.get("/api/public/notes/:id", (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  const author = n ? getUserById(n.user_id) : undefined;
  if (!n || n.visibility !== "public" || n.archived || !author || author.status !== "active") {
    return fail(res, 404, "笔记不存在或不可见");
  }
  if (req.query.view === "1") bumpViews(n.id);
  ok(res, { note: noteJson(n) });
});

// ---------- sitemap / robots ----------
app.get("/sitemap.xml", (req, res) => {
  const origin = siteOrigin(req);
  const rows = db.prepare(
    "SELECT n.id, n.updated_at FROM notes n JOIN users u ON u.id=n.user_id WHERE n.visibility='public' AND n.archived=0 AND u.status='active' ORDER BY n.updated_at DESC"
  ).all() as { id: number; updated_at: number }[];
  const urls = rows.map((r) => {
    const d = new Date(r.updated_at);
    const lastmod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `  <url><loc>${escAttr(`${origin}/n/${r.id}`)}</loc><lastmod>${lastmod}</lastmod></url>`;
  }).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${siteOrigin(req)}/sitemap.xml\n`);
});

// ---------- 分享链接（token 即凭证：私密笔记也可凭链接查看，但不进广场/搜索） ----------
function ensureShareToken(n: NoteRow): string {
  if (n.share_token) return n.share_token;
  const t = randomToken(24);
  db.prepare("UPDATE notes SET share_token=? WHERE id=?").run(t, n.id);
  return t;
}
app.get("/api/notes/:id/share", (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n) return fail(res, 404, "笔记不存在");
  const me = getSessionUser(req);
  const isAuthor = !!me && me.id === n.user_id;
  if (n.visibility === "public" && !n.archived) {
    const author = getUserById(n.user_id);
    if (!author || author.status !== "active") return fail(res, 404, "笔记不存在或不可见");
  } else if (!isAuthor) {
    // 私密/归档笔记的分享信息仅作者可取
    return fail(res, 404, "笔记不存在或不可见");
  }
  const token = ensureShareToken(n);
  ok(res, { token, url: `${siteOrigin(req)}/s/${token}`, isAuthor });
});
app.post("/api/notes/:id/share/reset", requireAuth, (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || n.user_id !== authedUser(req).id) return fail(res, 404, "笔记不存在");
  const token = randomToken(24);
  db.prepare("UPDATE notes SET share_token=? WHERE id=?").run(token, n.id);
  ok(res, { token, url: `${siteOrigin(req)}/s/${token}`, isAuthor: true });
});
app.get("/api/share/:token", (req, res) => {
  const token = String(req.params.token || "");
  if (!token) return fail(res, 404, "链接不存在或已失效");
  const n = db.prepare("SELECT * FROM notes WHERE share_token=?").get(token) as NoteRow | undefined;
  if (!n) return fail(res, 404, "链接不存在或已失效");
  const author = getUserById(n.user_id);
  if (!author || author.status !== "active") return fail(res, 404, "链接不存在或已失效");
  if (req.query.view === "1") bumpViews(n.id);
  ok(res, { note: noteJson(n) });
});

// ---------- 评论（正文以纯文本存储与渲染，不做 HTML 拼接） ----------
interface CommentRow { id: number; note_id: number; user_id: number; content: string; created_at: number }
function commentJson(c: CommentRow) {
  const a = getUserById(c.user_id);
  return {
    id: c.id, noteId: c.note_id, userId: c.user_id, content: c.content, createdAt: c.created_at,
    author: a ? { id: a.id, username: a.username, nickname: a.nickname || a.username, avatar: a.avatar } : null,
  };
}
app.get("/api/notes/:id/comments", (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || !visibleNote(req, n)) return fail(res, 404, "笔记不存在或不可见");
  if (!n.allow_comments) return ok(res, { comments: [], total: 0, allowComments: false });
  const rows = db.prepare("SELECT * FROM comments WHERE note_id=? ORDER BY created_at ASC, id ASC LIMIT 500").all(n.id) as unknown as CommentRow[];
  ok(res, { comments: rows.map(commentJson), total: rows.length, allowComments: true });
});
app.post("/api/notes/:id/comments", requireAuth, rateLimit(30, 60_000, "comment"), (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || !visibleNote(req, n)) return fail(res, 404, "笔记不存在或不可见");
  if (!n.allow_comments) return fail(res, 403, "作者已关闭评论");
  const content = String(req.body?.content || "").trim();
  if (!content) return fail(res, 400, "评论内容不能为空");
  if (content.length > 500) return fail(res, 400, "评论最多 500 字");
  const info = db.prepare("INSERT INTO comments(note_id,user_id,content,created_at) VALUES(?,?,?,?)")
    .run(n.id, authedUser(req).id, content, Date.now());
  const c = db.prepare("SELECT * FROM comments WHERE id=?").get(Number(info.lastInsertRowid)) as unknown as CommentRow;
  ok(res, { comment: commentJson(c) });
});
app.delete("/api/comments/:id", requireAuth, (req, res) => {
  const c = db.prepare("SELECT * FROM comments WHERE id=?").get(Number(req.params.id)) as CommentRow | undefined;
  if (!c) return fail(res, 404, "评论不存在");
  const me = authedUser(req);
  const n = db.prepare("SELECT user_id FROM notes WHERE id=?").get(c.note_id) as { user_id: number } | undefined;
  if (c.user_id !== me.id && (!n || n.user_id !== me.id) && me.role !== "admin") return fail(res, 403, "无权删除这条评论");
  db.prepare("DELETE FROM comments WHERE id=?").run(c.id);
  ok(res);
});
const countNoteImages = (content: string) => ((content || "").match(/!\[[^\]]*\]\([^)\s]+\)/g) || []).length;
// 正文中的本地上传图路径（/uploads/images/xxx），用于删除笔记/移除图片时清理孤儿文件
const localImagePathsOf = (content: string): string[] => {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\((\/uploads\/images\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content || ""))) out.add(m[1]);
  return [...out];
};
// 删除不再被任何笔记引用的本地图片（文件 + media 记录）。excludeNoteId 用于"编辑移除"场景：
// 只清理旧内容有、新内容没有的图片，且该图片未被其他笔记引用，避免误删。
const cleanupOrphanedImages = (paths: string[], excludeNoteId?: number) => {
  for (const p of paths) {
    try {
      const like = `%${p.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const sql = excludeNoteId === undefined
        ? "SELECT COUNT(*) c FROM notes WHERE content LIKE ? ESCAPE '\\'"
        : "SELECT COUNT(*) c FROM notes WHERE id != ? AND content LIKE ? ESCAPE '\\'";
      const args = excludeNoteId === undefined ? [like] : [excludeNoteId, like];
      const ref = (db.prepare(sql).get(...args) as { c: number }).c;
      if (ref > 0) continue; // 仍被其他笔记引用，保留
      try { unlinkSync(join(STORAGE_DIR, p.replace("/uploads/", ""))); } catch { /* 文件已不存在 */ }
      db.prepare("DELETE FROM media WHERE path=?").run(p);
    } catch { /* 清理失败不影响主流程 */ }
  }
};
app.post("/api/notes", requireAuth, (req, res) => {
  const u = authedUser(req);
  const title = String(req.body?.title || "").trim().slice(0, 120);
  const content = String(req.body?.content || "");
  if (!content.trim() && !title) return fail(res, 400, "标题和正文至少填一项");
  if (countNoteImages(content) > 9) return fail(res, 400, "每篇独白最多插入 9 张图片");
  const tags = Array.isArray(req.body?.tags) ? (req.body.tags as unknown[]).map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 10) : [];
  const now = Date.now();
  const info = db.prepare("INSERT INTO notes(user_id,title,content,tags,weather,location,visibility,pinned,archived,allow_comments,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(u.id, title, content, JSON.stringify(tags), String(req.body?.weather || "").slice(0, 30), String(req.body?.location || "").slice(0, 60),
      req.body?.visibility === "private" ? "private" : "public", req.body?.pinned ? 1 : 0, req.body?.archived ? 1 : 0,
      req.body?.allowComments === false ? 0 : 1, now, now);
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(info.lastInsertRowid)) as unknown as NoteRow;
  ok(res, { note: noteJson(n) });
});
app.put("/api/notes/:id", requireAuth, (req, res) => {
  const u = authedUser(req);
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || n.user_id !== u.id) return fail(res, 404, "笔记不存在");
  const newContent = String(req.body?.content ?? n.content);
  if (countNoteImages(newContent) > 9) return fail(res, 400, "每篇独白最多插入 9 张图片");
  const tags = Array.isArray(req.body?.tags) ? (req.body.tags as unknown[]).map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 10) : JSON.parse(n.tags);
  db.prepare("UPDATE notes SET title=?,content=?,tags=?,weather=?,location=?,visibility=?,pinned=?,archived=?,allow_comments=?,updated_at=? WHERE id=?")
    .run(String(req.body?.title ?? n.title).slice(0, 120), newContent, JSON.stringify(tags),
      String(req.body?.weather ?? n.weather).slice(0, 30), String(req.body?.location ?? n.location).slice(0, 60),
      req.body?.visibility === "private" ? "private" : "public", req.body?.pinned ? 1 : 0, req.body?.archived ? 1 : 0,
      req.body?.allowComments !== undefined ? (req.body.allowComments ? 1 : 0) : n.allow_comments, Date.now(), n.id);
  // 编辑时删掉的图片：若不再被其他笔记引用，删除文件释放空间
  const removed = localImagePathsOf(n.content).filter((p) => !localImagePathsOf(newContent).includes(p));
  if (removed.length) cleanupOrphanedImages(removed, n.id);
  ok(res, { note: noteJson(db.prepare("SELECT * FROM notes WHERE id=?").get(n.id) as unknown as NoteRow) });
});
app.delete("/api/notes/:id", requireAuth, (req, res) => {
  const u = authedUser(req);
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || (n.user_id !== u.id && u.role !== "admin")) return fail(res, 404, "笔记不存在");
  const imgPaths = localImagePathsOf(n.content);
  db.prepare("DELETE FROM comments WHERE note_id=?").run(n.id);
  db.prepare("DELETE FROM notes WHERE id=?").run(n.id);
  // 笔记删除后，其本地图片若不再被其他笔记引用，删除文件释放空间
  if (imgPaths.length) cleanupOrphanedImages(imgPaths);
  ok(res);
});
app.get("/api/me/notes", requireAuth, (req, res) => {
  const f = String(req.query.filter || "all");
  const conds = ["user_id=?"];
  const args: (string | number)[] = [authedUser(req).id];
  if (f === "public") conds.push("visibility='public'", "archived=0");
  if (f === "private") conds.push("visibility='private'", "archived=0");
  if (f === "archived") conds.push("archived=1");
  const rows = db.prepare(`SELECT * FROM notes WHERE ${conds.join(" AND ")} ORDER BY pinned DESC, created_at DESC LIMIT 200`).all(...args) as unknown as NoteRow[];
  ok(res, { notes: rows.map((n) => noteJson(n, false)) });
});
app.get("/api/tags", (req, res) => {
  const me = getSessionUser(req);
  const mine = req.query.mine === "1" && me;
  const rows = db.prepare(mine
    ? "SELECT tags FROM notes WHERE user_id=? AND archived=0"
    : "SELECT n.tags FROM notes n JOIN users u ON u.id=n.user_id WHERE n.visibility='public' AND n.archived=0 AND u.status='active'")
    .all(...(mine ? [me!.id] : [])) as { tags: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of JSON.parse(r.tags || "[]") as string[]) counts.set(t, (counts.get(t) || 0) + 1);
  ok(res, { tags: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
});
app.get("/api/calendar", (req, res) => {
  const me = getSessionUser(req);
  const mine = req.query.mine === "1" && me;
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 400, "月份格式应为 YYYY-MM");
  const rows = db.prepare(mine
    ? "SELECT date(created_at/1000,'unixepoch','localtime') d, COUNT(*) c FROM notes WHERE user_id=? AND archived=0 AND strftime('%Y-%m',created_at/1000,'unixepoch','localtime')=? GROUP BY d"
    : "SELECT date(n.created_at/1000,'unixepoch','localtime') d, COUNT(*) c FROM notes n JOIN users u ON u.id=n.user_id WHERE n.visibility='public' AND n.archived=0 AND u.status='active' AND strftime('%Y-%m',n.created_at/1000,'unixepoch','localtime')=? GROUP BY d")
    .all(...(mine ? [me!.id, month] : [month])) as { d: string; c: number }[];
  ok(res, { days: Object.fromEntries(rows.map((r) => [r.d, r.c])) });
});

// ---------- 管理员后台 ----------
app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  ok(res, {
    users: one("SELECT COUNT(*) c FROM users"),
    notes: one("SELECT COUNT(*) c FROM notes"),
    oauthBindings: one("SELECT COUNT(*) c FROM oauth_accounts"),
    todayUsers: one(`SELECT COUNT(*) c FROM users WHERE created_at>=${today.getTime()}`),
    todayNotes: one(`SELECT COUNT(*) c FROM notes WHERE created_at>=${today.getTime()}`),
    todayVisits: one(`SELECT COUNT(*) c FROM visits WHERE created_at>=${today.getTime()}`),
    totalViews: (() => { try { return (db.prepare("SELECT COALESCE(SUM(views),0) v FROM site_views").get() as { v: number }).v; } catch { return 0; } })(),
    todayViews: (() => {
      try {
        const t = new Date();
        const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        return (db.prepare("SELECT COALESCE(views,0) v FROM site_views WHERE day=?").get(day) as { v: number } | undefined)?.v || 0;
      } catch { return 0; }
    })(),
    recentUsers: (db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 8").all() as unknown as UserRow[]).map((u) => publicUser(u)),
  });
});
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = (q
    ? db.prepare("SELECT * FROM users WHERE username LIKE ? OR nickname LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 200").all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 200").all()) as unknown as UserRow[];
  const binds = db.prepare("SELECT user_id, provider FROM oauth_accounts").all() as { user_id: number; provider: string }[];
  const map = new Map<number, string[]>();
  for (const b of binds) map.set(b.user_id, [...(map.get(b.user_id) || []), b.provider]);
  ok(res, { users: rows.map((u) => ({ ...publicUser(u), emailFull: u.email, oauth: map.get(u.id) || [] })) });
});
app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const me = authedUser(req);
  const target = getUserById(Number(req.params.id));
  if (!target) return fail(res, 404, "用户不存在");
  if (req.body?.status !== undefined) {
    const status = req.body.status === "disabled" ? "disabled" : "active";
    db.prepare("UPDATE users SET status=? WHERE id=?").run(status, target.id);
    if (status === "disabled") destroyAllSessions(target.id);
  }
  if (req.body?.role !== undefined) {
    const role = req.body.role === "admin" ? "admin" : "user";
    if (role === "user" && target.role === "admin") {
      const admins = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as { c: number }).c;
      if (target.id === me.id) return fail(res, 400, "不能取消自己的管理员身份");
      if (admins <= 1) return fail(res, 400, "不能取消最后一个管理员");
    }
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role, target.id);
  }
  ok(res, { user: publicUser(getUserById(target.id)!) });
});
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const me = authedUser(req);
  const target = getUserById(Number(req.params.id));
  if (!target) return fail(res, 404, "用户不存在");
  if (target.id === me.id) return fail(res, 400, "不能删除自己");
  if (target.role === "admin") {
    const admins = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as { c: number }).c;
    if (admins <= 1) return fail(res, 400, "不能删除最后一个管理员");
  }
  const files = db.prepare("SELECT path FROM media WHERE user_id=?").all(target.id) as { path: string }[];
  db.prepare("DELETE FROM comments WHERE user_id=?").run(target.id);
  db.prepare("DELETE FROM users WHERE id=?").run(target.id);
  for (const f of files) { try { unlinkSync(join(STORAGE_DIR, f.path.replace("/uploads/", ""))); } catch { /* ignore */ } }
  ok(res);
});
app.get("/api/admin/notes", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM notes ORDER BY created_at DESC LIMIT 200").all() as unknown as NoteRow[];
  ok(res, { notes: rows.map((n) => noteJson(n)) });
});
app.post("/api/admin/notes/:id/takedown", requireAdmin, (req, res) => {
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n) return fail(res, 404, "笔记不存在");
  db.prepare("UPDATE notes SET visibility='private' WHERE id=?").run(n.id);
  ok(res);
});

app.get("/api/admin/site", requireAdmin, (_req, res) => {
  ok(res, {
    name: getSetting("site_name", "己素"), subtitle: getSetting("site_subtitle", "Jisu"),
    description: getSetting("site_description", ""), keywords: getSetting("site_keywords", ""),
    footer: getSetting("site_footer", ""), icp: getSetting("site_icp", "黔ICP备2026016351号-1"),
    logo: getSetting("site_logo", ""), url: getSetting("site_url", ""),
    accent: getSetting("site_accent", ""),
    registerOpen: getSetting("site_register_open", "1") === "1",
    inviteOnly: getSetting("site_invite_only", "0") === "1",
    oauthShowLogin: getSetting("oauth_show_login", "1") === "1",
  });
});
app.put("/api/admin/site", requireAdmin, (req, res) => {
  const b = req.body || {};
  const str = (k: string, max: number) => String(b[k] ?? "").slice(0, max);
  setSetting("site_name", str("name", 60) || "己素");
  setSetting("site_subtitle", str("subtitle", 120));
  setSetting("site_description", str("description", 300));
  setSetting("site_keywords", str("keywords", 200));
  setSetting("site_footer", str("footer", 300));
  setSetting("site_icp", str("icp", 60));
  setSetting("site_url", str("url", 200).replace(/\/$/, ""));
  const accent = str("accent", 7);
  setSetting("site_accent", /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "");
  setSetting("site_register_open", b.registerOpen === false ? "0" : "1");
  if (b.inviteOnly !== undefined) setSetting("site_invite_only", b.inviteOnly ? "1" : "0");
  setSetting("oauth_show_login", b.oauthShowLogin === false ? "0" : "1");
  ok(res);
});
app.post("/api/admin/logo", requireAdmin, upload.single("file"), uploadErr, (req: Request, res: Response) => handleUpload(req, res, "site"));

// ---------- 邀请码 ----------
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉易混淆的 0/O/1/I/L
const genInviteCode = (): string => {
  let s = "";
  for (let i = 0; i < 10; i++) s += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  return s;
};
app.get("/api/admin/invite-codes", requireAdmin, (_req, res) => {
  const rows = db.prepare(
    `SELECT c.code, c.created_at, c.used_at, c.used_by, u.username AS used_by_name
     FROM invite_codes c LEFT JOIN users u ON u.id = c.used_by
     ORDER BY c.created_at DESC LIMIT 500`
  ).all() as { code: string; created_at: number; used_at: number | null; used_by: number | null; used_by_name: string | null }[];
  ok(res, { codes: rows, inviteOnly: getSetting("site_invite_only", "0") === "1" });
});
app.post("/api/admin/invite-codes", requireAdmin, rateLimit(30, 60_000, "invite-gen"), (req, res) => {
  const count = Math.max(1, Math.min(100, Math.floor(Number(req.body?.count) || 1)));
  const made: string[] = [];
  const ins = db.prepare("INSERT OR IGNORE INTO invite_codes(code, created_at) VALUES(?, ?)");
  for (let i = 0; i < count && made.length < count; i++) {
    const code = genInviteCode();
    const r = ins.run(code, Date.now());
    if (r.changes > 0) made.push(code);
  }
  ok(res, { codes: made });
});
app.delete("/api/admin/invite-codes/:code", requireAdmin, (req, res) => {
  const code = String(req.params.code || "").toUpperCase().trim();
  const r = db.prepare("DELETE FROM invite_codes WHERE code=? AND used_at IS NULL").run(code);
  if (r.changes === 0) return fail(res, 404, "邀请码不存在或已使用");
  ok(res);
});

app.get("/api/admin/smtp", requireAdmin, (_req, res) => {
  ok(res, {
    host: getSetting("smtp_host"), port: Number(getSetting("smtp_port", "465")), secure: getSetting("smtp_secure", "1") === "1",
    user: getSetting("smtp_user"), from: getSetting("smtp_from"), fromName: getSetting("smtp_from_name"),
    enabled: getSetting("smtp_enabled") === "1", hasPass: !!getSetting("smtp_pass_enc"),
  });
});
app.put("/api/admin/smtp", requireAdmin, (req, res) => {
  const b = req.body || {};
  setSetting("smtp_host", String(b.host || "").slice(0, 120));
  setSetting("smtp_port", String(Number(b.port) || 465));
  setSetting("smtp_secure", b.secure === false ? "0" : "1");
  setSetting("smtp_user", String(b.user || "").slice(0, 120));
  setSetting("smtp_from", String(b.from || "").slice(0, 120));
  setSetting("smtp_from_name", String(b.fromName || "").slice(0, 60));
  setSetting("smtp_enabled", b.enabled === false ? "0" : "1");
  if (b.pass) setSetting("smtp_pass_enc", encryptSecret(String(b.pass)));
  ok(res);
});
app.post("/api/admin/smtp/test", requireAdmin, async (req, res) => {
  const cfg = getSmtpConfig();
  if (!cfg) return fail(res, 400, "尚未配置可用的 SMTP（后台启用并填写主机与账号，或提供环境变量）");
  const to = String(req.body?.to || authedUser(req).email || "");
  if (!EMAIL_RE.test(to)) return fail(res, 400, "请填写有效的测试收件邮箱");
  const r = await sendMail(to, `${cfg.fromName || getSetting("site_name", "己素")} · 测试邮件`, "这是一封 SMTP 配置测试邮件，收到即表示发信配置可用。");
  if (!r.ok) return fail(res, 502, `测试邮件发送失败：${r.error}`);
  ok(res, { to });
});

// ---- 天气与位置设置（和风天气 KEY + 腾讯位置服务 KEY，AES-256-GCM 加密存储，接口永不回显明文） ----
app.get("/api/admin/geo", requireAdmin, (_req, res) => {
  ok(res, {
    weather: { enabled: getSetting("weather_enabled") === "1", hasKey: !!getSetting("weather_qweather_key_enc"), hasHost: !!getSetting("weather_qweather_host_enc") },
    geo: { enabled: getSetting("geo_enabled") === "1", hasKey: !!getSetting("geo_qq_key_enc") },
  });
});
app.put("/api/admin/geo", requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.weather) {
    setSetting("weather_enabled", b.weather.enabled === false ? "0" : "1");
    if (b.weather.clearKey) setSetting("weather_qweather_key_enc", "");
    else if (b.weather.key) setSetting("weather_qweather_key_enc", encryptSecret(String(b.weather.key).trim().slice(0, 80)));
    if (b.weather.clearHost) setSetting("weather_qweather_host_enc", "");
    else if (b.weather.host) {
      const hn = normalizeQweatherHost(String(b.weather.host));
      if (!hn) return fail(res, 400, "API Host 格式无效：只填主机名（如 xxx.qweatherapi.com），不要带 https://，仅允许字母、数字、点、横线");
      setSetting("weather_qweather_host_enc", encryptSecret(hn));
    }
  }
  if (b.geo) {
    setSetting("geo_enabled", b.geo.enabled === false ? "0" : "1");
    if (b.geo.clearKey) setSetting("geo_qq_key_enc", "");
    else if (b.geo.key) setSetting("geo_qq_key_enc", encryptSecret(String(b.geo.key).trim().slice(0, 80)));
  }
  ok(res, {
    weather: { hasKey: !!getSetting("weather_qweather_key_enc"), hasHost: !!getSetting("weather_qweather_host_enc") },
    geo: { hasKey: !!getSetting("geo_qq_key_enc") },
  });
});

// 和风实况：只读设置、不打日志、不回显 key
async function qweatherNow(lat: number, lon: number): Promise<{ desc: string; temp: number } | { qerror: string }> {
  const key = decryptSecret(getSetting("weather_qweather_key_enc"));
  if (!key) return { qerror: "未配置 API KEY" };
  if (getSetting("weather_enabled") !== "1") return { qerror: "天气服务未启用" };
  // 和风 API Host 必须走管理后台配置：为空即视为未配置（代码里不写死任何 host），直接回退
  const host = normalizeQweatherHost(decryptSecret(getSetting("weather_qweather_host_enc")));
  if (!host) return { qerror: "未配置 API Host（请在管理后台「天气与位置」填写和风专属 API Host）" };
  let status = 0, d: any = null;
  try {
    const r = await fetch(`https://${host}/v7/weather/now?location=${lon.toFixed(2)},${lat.toFixed(2)}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    status = r.status;
    const text = await r.text();
    try { d = text.trim() ? JSON.parse(text) : null; } catch { d = null; }
  } catch {
    return { qerror: "请求和风接口失败（网络或超时）" };
  }
  if (status === 200 && d?.code === "200" && d?.now) {
    const temp = Number(d.now.temp);
    return { desc: String(d.now.text || ""), temp: Number.isFinite(temp) ? temp : NaN };
  }
  // 和风异常形态：HTTP 4xx/5xx + {error:{title,detail}}，或 200 + {code:"4xx"}
  const ej = d?.error;
  const invalidHost = /invalid host/i.test(`${ej?.title || ""} ${ej?.detail || ""}`);
  if (status === 403 || ej?.status === 403 || invalidHost) {
    return { qerror: "和风返回 403（Invalid Host）：请检查 API Host 是否为控制台（console.qweather.com）专属域名，如 xxx.qweatherapi.com" };
  }
  if (ej) return { qerror: `和风返回 ${ej.status ?? status}（${ej.title || ej.detail || "未知错误"}）` };
  const codeMsg: Record<string, string> = {
    "400": "请求错误", "401": "key 无效或无权限", "402": "超过访问次数", "403": "无访问权限",
    "404": "位置不存在", "429": "访问过于频繁", "500": "和风服务异常",
  };
  const code = d?.code ?? `HTTP ${status}`;
  return { qerror: `和风返回 ${code}${codeMsg[d?.code ?? ""] ? `（${codeMsg[d?.code ?? ""]}）` : ""}` };
}
// 编辑器自动获取：有 key 走和风实况，否则 503 由客户端回退 Open-Meteo（登录态，防额度滥用）
app.get("/api/weather/current", requireAuth, async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail(res, 400, "坐标无效");
  const r = await qweatherNow(lat, lon);
  if ("qerror" in r) return res.status(503).json({ ok: false });
  ok(res, { desc: r.desc, temp: r.temp });
});
app.post("/api/admin/geo/test-weather", requireAdmin, async (req, res) => {
  const lat = Number(req.body?.lat), lon = Number(req.body?.lon);
  const r = await qweatherNow(Number.isFinite(lat) ? lat : 39.9042, Number.isFinite(lon) ? lon : 116.4074);
  if ("qerror" in r) return ok(res, { ok: false, error: r.qerror });
  ok(res, { ok: true, desc: r.desc, temp: r.temp });
});

// 腾讯位置服务逆地理：只读设置、不打日志、不回显 key
// TENCENT_GEO_API 仅用于测试时指向本地 stub，默认走官方域名
const TENCENT_GEO_API = process.env.TENCENT_GEO_API || "https://apis.map.qq.com";
async function tencentReverse(lat: number, lon: number): Promise<{ district: string; city: string; province: string; label: string } | { qerror: string }> {
  const key = decryptSecret(getSetting("geo_qq_key_enc"));
  if (!key) return { qerror: "未配置 Key" };
  if (getSetting("geo_enabled") !== "1") return { qerror: "位置服务未启用" };
  let status = 0, d: any = null;
  try {
    const r = await fetch(`${TENCENT_GEO_API}/ws/geocoder/v1/?location=${lat.toFixed(5)},${lon.toFixed(5)}&key=${encodeURIComponent(key)}&get_poi=0`, { signal: AbortSignal.timeout(8000) });
    status = r.status;
    const text = await r.text();
    try { d = text.trim() ? JSON.parse(text) : null; } catch { d = null; }
  } catch {
    return { qerror: "请求腾讯位置服务失败（网络或超时）" };
  }
  const ac = d?.result?.address_component;
  if (d?.status === 0) {
    const p = parseTencentAddressComponent(ac);
    if (p) return p;
    return { qerror: "未解析到有效地址" };
  }
  return { qerror: `腾讯返回 ${d?.status ?? ("HTTP " + status)}${d?.message ? `（${d.message}）` : ""}` };
}
// 编辑器自动获取：有腾讯 key 走其逆地理，否则 503 由客户端回退 BigDataCloud（登录态，防额度滥用）
app.get("/api/geo/reverse", requireAuth, async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail(res, 400, "坐标无效");
  const r = await tencentReverse(lat, lon);
  if ("qerror" in r) return res.status(503).json({ ok: false });
  ok(res, { ...r });
});
app.post("/api/admin/geo/test-geo", requireAdmin, async (req, res) => {
  // 固定用达州坐标验证 key 可用性与解析口径
  const r = await tencentReverse(31.21, 107.47);
  if ("qerror" in r) return ok(res, { ok: false, error: r.qerror });
  ok(res, { ok: true, ...r });
});

// 图片代理：登录态 + SSRF 防护，供分享海报加载外链图（同源回源，无 CORS 问题）。
// SSRF：只允许 http/https、默认端口，DNS 解析后逐 IP 拦截私网/回环/链路本地；重定向逐跳重验。
app.get("/api/proxy-image", requireAuth, rateLimit(60, 60_000, "proxyimg"), async (req, res) => {
  const raw = String(req.query.url || "");
  if (!raw) return fail(res, 400, "缺少 url 参数");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const target = await assertProxyTarget(raw);
    const { bytes, contentType } = await fetchProxyImage(target, ctrl.signal);
    res.status(200)
      .set("Content-Type", contentType)
      .set("Content-Length", String(bytes.length))
      .set("Cache-Control", "public, max-age=86400")
      .end(bytes);
  } catch (e) {
    if (e instanceof ProxyImageError) {
      console.warn(`[proxy-image] ${e.status} ${raw.slice(0, 160)}: ${e.message}`);
      return fail(res, e.status === 400 ? 400 : 502, e.message);
    }
    console.warn(`[proxy-image] 502 ${raw.slice(0, 160)}: 图片抓取失败`);
    return fail(res, 502, "图片抓取失败");
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/admin/oauth", requireAdmin, (req, res) => {
  const out: Record<string, unknown> = {};
  for (const p of PROVIDERS) {
    const cfg = getProviderConfig(p);
    out[p] = { enabled: getSetting(`oauth_${p}_enabled`) === "1", clientId: cfg.clientId, hasSecret: cfg.hasSecret, callback: callbackUri(req, p) };
  }
  ok(res, { providers: out });
});
app.put("/api/admin/oauth/:provider", requireAdmin, (req, res) => {
  const p = req.params.provider as Provider;
  if (!PROVIDERS.includes(p)) return fail(res, 404, "不支持的第三方");
  const b = req.body || {};
  saveProviderConfig(p, b.enabled === true, String(b.clientId || "").slice(0, 200), b.secret ? String(b.secret) : undefined);
  ok(res);
});
app.post("/api/admin/oauth/test", requireAdmin, (req, res) => {
  // 低成本校验：仅检查已保存配置非空与回调地址可构造，不真发 OAuth 请求
  const p = req.body?.provider as Provider;
  if (!PROVIDERS.includes(p)) return fail(res, 400, "请选择第三方平台");
  const cfg = getProviderConfig(p);
  if (!cfg.clientId || !cfg.hasSecret) return fail(res, 400, `${p === "github" ? "GitHub" : "QQ"} 配置不完整：请填写 Client ID/App ID 与密钥后保存`);
  ok(res, { callback: callbackUri(req, p), message: "配置项完整，回调地址可正常构造" });
});

app.get("/api/health", (_req, res) => ok(res, { time: Date.now() }));

// ---------- 数据备份（导出/恢复，仅管理员） ----------
// 导出走一次性 token（60 秒有效，用后即焚）防盗链；恢复需二次确认（前端弹窗），
// 恢复前自动把当前库备份到 data/backups（保留最近 5 份），替换后必须重启容器生效。
const backupTokens = new Map<string, number>();
app.post("/api/admin/backup/token", requireAdmin, (_req, res) => {
  const token = randomToken(24);
  backupTokens.set(token, Date.now() + 60_000);
  ok(res, { token });
});
app.get("/api/admin/backup/download", (req, res) => {
  const token = String(req.query.token || "");
  const exp = backupTokens.get(token);
  backupTokens.delete(token);
  if (!exp || exp < Date.now()) return fail(res, 403, "下载凭证无效或已过期，请重新点击导出");
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
  const t = new Date();
  const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}${String(t.getSeconds()).padStart(2, "0")}`;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="notepro-backup-${stamp}.db"`);
  res.sendFile(DB_PATH);
});
const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
app.post("/api/admin/backup/restore", requireAdmin, backupUpload.single("file"), (req, res) => {
  const buf = req.file?.buffer;
  if (!buf || buf.length < 100) return fail(res, 400, "未收到有效的备份文件");
  if (buf.subarray(0, 16).toString() !== "SQLite format 3\0") return fail(res, 400, "文件不是有效的 SQLite 数据库");
  // 校验表结构：先写临时文件只读打开检查
  const tmp = join(DATA_DIR, `restore-check-${Date.now()}.db`);
  try {
    writeFileSync(tmp, buf);
    const chk = new DatabaseSync(tmp, { readOnly: true });
    try {
      const tables = new Set(
        (chk.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
      );
      for (const t of ["users", "notes", "settings", "comments", "oauth_accounts", "sessions"]) {
        if (!tables.has(t)) throw new Error(`缺少数据表：${t}`);
      }
      chk.exec("PRAGMA quick_check");
    } finally { chk.close(); }
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return fail(res, 400, `备份文件校验失败：${(e as Error).message}`);
  }
  try { unlinkSync(tmp); } catch { /* ignore */ }
  // 恢复前先备份当前库到 data/backups（最多保留 5 份）
  try {
    const bdir = join(DATA_DIR, "backups");
    mkdirSync(bdir, { recursive: true });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const t = new Date();
    const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}${String(t.getSeconds()).padStart(2, "0")}`;
    copyFileSync(DB_PATH, join(bdir, `notepro-${stamp}.db`));
    const olds = readdirSync(bdir).filter((f) => f.startsWith("notepro-") && f.endsWith(".db")).sort();
    while (olds.length > 5) { try { unlinkSync(join(bdir, olds.shift()!)); } catch { /* ignore */ } }
  } catch (e) {
    return fail(res, 500, `备份当前数据库失败，已中止恢复：${(e as Error).message}`);
  }
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writeFileSync(DB_PATH, buf);
    for (const suf of ["-wal", "-shm"]) { try { unlinkSync(DB_PATH + suf); } catch { /* ignore */ } }
  } catch (e) {
    return fail(res, 500, `写入备份失败：${(e as Error).message}`);
  }
  console.log("[backup] database restored from upload; container restart required");
  ok(res, { message: "备份已恢复并保留了恢复前自动备份（data/backups）。请重启容器后生效，重建前站点将暂停服务。" });
  // 关闭旧句柄：后续请求直接报错，避免静默写入已脱离的旧文件
  setImmediate(() => { try { db.close(); } catch { /* ignore */ } });
});

// ---------- 前端静态与 SPA 回退 ----------
// 部分浏览器会兜底请求 /favicon.ico，统一跳到当前生效图标
app.get("/favicon.ico", (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.redirect(302, effectiveIcon());
});

const PUBLIC_DIR = join(process.cwd(), "dist", "public");
if (existsSync(PUBLIC_DIR)) {
  // index:false 关掉静态目录直出首页：所有 HTML 统一经 renderIndex 注入站点信息，
  // 第一帧就是后台设置的站点名/Logo/标签图标，不再先闪默认「己素」与蓝 N，也省一次 /api/site 往返
  app.use(express.static(PUBLIC_DIR, { maxAge: "1h", index: false }));
  let indexCache: string | null = null;
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // 主题强调色衍生（与前端 api.ts 的 accentCss 同口径，保持两边一致）
  const shade = (hex: string, amt: number): string => {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  };
  const mix = (h1: string, h2: string, r: number): string => {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
    const m = (x: number, y: number) => ch(x * r + y * (1 - r));
    return `#${m((a >> 16) & 255, (b >> 16) & 255)}${m((a >> 8) & 255, (b >> 8) & 255)}${m(a & 255, b & 255)}`;
  };
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const l = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * l((n >> 16) & 255) + 0.7152 * l((n >> 8) & 255) + 0.0722 * l(n & 255);
  };
  const accentStyle = (hex: string): string => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "";
    const onL = luminance(hex) > 0.45 ? "#202124" : "#ffffff";
    const dAcc = shade(hex, 0.28);
    const onD = luminance(dAcc) > 0.45 ? "#202124" : "#ffffff";
    return `<style id="np-accent">:root{--accent:${hex};--accent-dark:${shade(hex, -0.15)};--accent-soft:${mix(hex, "#ffffff", 0.12)};--on-accent:${onL}}` +
      `[data-theme="dark"]{--accent:${dAcc};--accent-dark:${shade(hex, 0.42)};--accent-soft:${mix(hex, "#201d19", 0.30)};--on-accent:${onD}}</style>`;
  };
  const renderIndex = (): string => {
    if (indexCache === null) indexCache = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
    const s = sitePayload();
    const icon = escHtml(effectiveIcon());
    const title = escHtml(s.subtitle ? `${s.name} - ${s.subtitle}` : s.name);
    const boot = JSON.stringify(s).replace(/</g, "\\u003c");
    return indexCache
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escHtml(s.description)}$2`)
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`)
      .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${icon}" />`)
      .replace("</head>", `${accentStyle(s.accent)}<script>window.__NP_SITE__=${boot}</script></head>`);
  };
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.set("Cache-Control", "no-cache");
    res.type("html").send(renderIndex());
  });
}

app.listen(PORT, () => {
  console.log(`NotePro server listening on :${PORT}`);
});
