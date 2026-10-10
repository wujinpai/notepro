import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { db, getSetting, setSetting } from "./db.js";
import { hashPassword, verifyPassword, sha256, encryptSecret, verifyPayload, signPayload, maskEmail } from "./util.js";
import { sendEmailCode, verifyEmailCode, createSliderChallenge, verifySlider, consumeTicket, getSmtpConfig, sendMail } from "./mail.js";
import {
  getUserById, getUserByUsername, getUserByEmail, publicUser, createSession, setSessionCookie, clearSessionCookie,
  getSessionUser, destroySession, destroyOtherSessions, destroyAllSessions, requireAuth, requireAdmin, authedUser, rateLimit, parseCookies,
} from "./auth.js";
import type { UserRow } from "./auth.js";
import { PROVIDERS, getProviderConfig, saveProviderConfig, authorizeUrl, exchangeProfile } from "./oauth.js";
import type { Provider } from "./oauth.js";

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
app.get("/api/site", (req, res) => {
  const oauth: string[] = [];
  for (const p of PROVIDERS) if (getProviderConfig(p).enabled && getSetting("oauth_show_login", "1") === "1") oauth.push(p);
  ok(res, {
    name: getSetting("site_name", "己素"),
    subtitle: getSetting("site_subtitle", "Jisu"),
    description: getSetting("site_description", "己素 Jisu：多用户笔记广场，记录、分享与发现。"),
    keywords: getSetting("site_keywords", "笔记,博客,己素,Jisu"),
    footer: getSetting("site_footer", ""),
    icp: getSetting("site_icp", "黔ICP备2026016351号-1"),
    logo: getSetting("site_logo", ""),
    registerOpen: getSetting("site_register_open", "1") === "1",
    oauthProviders: oauth,
  });
});

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
  const info = db.prepare("INSERT INTO users(username,email,password_hash,nickname,role,created_at) VALUES(?,?,?,?,?,?)")
    .run(username, email, hashPassword(password), username, role, Date.now());
  const user = getUserById(Number(info.lastInsertRowid))!;
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
app.get("/api/auth/oauth/:provider/start", (req, res) => {
  const p = req.params.provider as Provider;
  if (!PROVIDERS.includes(p)) return fail(res, 404, "不支持的第三方登录");
  const cfg = getProviderConfig(p);
  if (!cfg.enabled) return fail(res, 400, "该第三方登录未配置或未启用");
  const me = getSessionUser(req);
  const bind = req.query.bind === "1" && me ? me.id : 0;
  const state = signPayload({ p, bind, t: Date.now() });
  res.redirect(authorizeUrl(p, cfg, callbackUri(req, p), state));
});
app.get("/api/auth/oauth/:provider/callback", async (req, res) => {
  const p = req.params.provider as Provider;
  const back = (msg: string) => res.redirect(`/?oauth_msg=${encodeURIComponent(msg)}`);
  if (!PROVIDERS.includes(p)) return back("不支持的第三方登录");
  const state = verifyPayload<{ p: string; bind: number; t: number }>(String(req.query.state || ""));
  if (!state || state.p !== p || Date.now() - state.t > 10 * 60_000) return back("授权已过期，请重新登录");
  const code = String(req.query.code || "");
  if (!code) return back("授权被取消或未取得授权码");
  const cfg = getProviderConfig(p);
  if (!cfg.enabled) return back("该第三方登录未配置或未启用");
  try {
    const profile = await exchangeProfile(p, cfg, code, callbackUri(req, p));
    const existing = db.prepare("SELECT user_id FROM oauth_accounts WHERE provider=? AND openid=?").get(p, profile.openid) as { user_id: number } | undefined;
    let user: UserRow | undefined;
    if (state.bind) {
      user = getUserById(state.bind);
      if (!user) return back("绑定失败：登录状态已失效");
      if (existing && existing.user_id !== user.id) return back("该第三方账号已绑定其他用户");
      if (!existing) {
        db.prepare("INSERT INTO oauth_accounts(user_id,provider,openid,unionid,provider_nickname,provider_avatar,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(user.id, p, profile.openid, profile.unionid, profile.nickname, profile.avatar, Date.now());
      }
      return res.redirect("/#me/accounts");
    }
    if (existing) {
      user = getUserById(existing.user_id);
      if (!user) return back("账号不存在");
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
    if (user.status !== "active") return back("账号已被禁用，请联系管理员");
    setSessionCookie(res, createSession(req, user.id));
    return res.redirect("/?oauth=ok");
  } catch (e) {
    return back((e as Error).message || "第三方登录失败");
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
  const password = String(req.body?.password || "");
  if (!EMAIL_RE.test(email)) return fail(res, 400, "邮箱格式不正确");
  // 有密码的账号须验当前密码；纯第三方账号（无密码）凭登录态 + 新邮箱验证码换绑
  if (u.password_hash && !verifyPassword(password, u.password_hash)) return fail(res, 400, "当前密码不正确");
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
}
function noteJson(n: NoteRow, withAuthor = true) {
  const author = withAuthor ? getUserById(n.user_id) : undefined;
  return {
    id: n.id, userId: n.user_id, title: n.title, content: n.content,
    tags: JSON.parse(n.tags || "[]") as string[],
    weather: n.weather, location: n.location, visibility: n.visibility,
    pinned: !!n.pinned, archived: !!n.archived, createdAt: n.created_at, updatedAt: n.updated_at,
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
  ok(res, { note: noteJson(n) });
});
const countNoteImages = (content: string) => ((content || "").match(/!\[[^\]]*\]\([^)\s]+\)/g) || []).length;
app.post("/api/notes", requireAuth, (req, res) => {
  const u = authedUser(req);
  const title = String(req.body?.title || "").trim().slice(0, 120);
  const content = String(req.body?.content || "");
  if (!content.trim() && !title) return fail(res, 400, "标题和正文至少填一项");
  if (countNoteImages(content) > 9) return fail(res, 400, "每篇独白最多插入 9 张图片");
  const tags = Array.isArray(req.body?.tags) ? (req.body.tags as unknown[]).map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 10) : [];
  const now = Date.now();
  const info = db.prepare("INSERT INTO notes(user_id,title,content,tags,weather,location,visibility,pinned,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(u.id, title, content, JSON.stringify(tags), String(req.body?.weather || "").slice(0, 30), String(req.body?.location || "").slice(0, 60),
      req.body?.visibility === "private" ? "private" : "public", req.body?.pinned ? 1 : 0, req.body?.archived ? 1 : 0, now, now);
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
  db.prepare("UPDATE notes SET title=?,content=?,tags=?,weather=?,location=?,visibility=?,pinned=?,archived=?,updated_at=? WHERE id=?")
    .run(String(req.body?.title ?? n.title).slice(0, 120), newContent, JSON.stringify(tags),
      String(req.body?.weather ?? n.weather).slice(0, 30), String(req.body?.location ?? n.location).slice(0, 60),
      req.body?.visibility === "private" ? "private" : "public", req.body?.pinned ? 1 : 0, req.body?.archived ? 1 : 0, Date.now(), n.id);
  ok(res, { note: noteJson(db.prepare("SELECT * FROM notes WHERE id=?").get(n.id) as unknown as NoteRow) });
});
app.delete("/api/notes/:id", requireAuth, (req, res) => {
  const u = authedUser(req);
  const n = db.prepare("SELECT * FROM notes WHERE id=?").get(Number(req.params.id)) as NoteRow | undefined;
  if (!n || (n.user_id !== u.id && u.role !== "admin")) return fail(res, 404, "笔记不存在");
  db.prepare("DELETE FROM notes WHERE id=?").run(n.id);
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
    registerOpen: getSetting("site_register_open", "1") === "1",
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
  setSetting("site_register_open", b.registerOpen === false ? "0" : "1");
  setSetting("oauth_show_login", b.oauthShowLogin === false ? "0" : "1");
  ok(res);
});
app.post("/api/admin/logo", requireAdmin, upload.single("file"), uploadErr, (req: Request, res: Response) => handleUpload(req, res, "site"));

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

// ---------- 前端静态与 SPA 回退 ----------
const PUBLIC_DIR = join(process.cwd(), "dist", "public");
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`NotePro server listening on :${PORT}`);
});
