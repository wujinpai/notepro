import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { sha256, randomToken, maskEmail } from "./util.js";

export interface UserRow {
  id: number; username: string; email: string | null; password_hash: string | null;
  nickname: string; avatar: string; signature: string; role: string; status: string; created_at: number;
}

export const getUserById = (id: number) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;
export const getUserByUsername = (u: string) => db.prepare("SELECT * FROM users WHERE username=?").get(u) as UserRow | undefined;
export const getUserByEmail = (e: string) => db.prepare("SELECT * FROM users WHERE email=?").get(e) as UserRow | undefined;

export function publicUser(u: UserRow, self = false) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname || u.username,
    avatar: u.avatar,
    signature: u.signature,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    email: self ? u.email : (u.email ? maskEmail(u.email) : null),
    hasPassword: !!u.password_hash,
  };
}

// ---------- 会话（token 哈希存储，可按会话下线）----------
export function createSession(req: Request, userId: number): string {
  const token = randomToken(32);
  db.prepare("INSERT INTO sessions(user_id,token_hash,ua,ip,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .run(userId, sha256(token), String(req.headers["user-agent"] || "").slice(0, 200), req.ip || "", Date.now(), Date.now() + 30 * 24 * 3600_000);
  return token;
}
export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setSessionCookie(res: Response, token: string) {
  res.setHeader("Set-Cookie", `np_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}
export function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", "np_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
export function getSessionUser(req: Request): UserRow | null {
  const token = parseCookies(req)["np_session"];
  if (!token) return null;
  const row = db.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?").get(sha256(token), Date.now()) as { user_id: number } | undefined;
  if (!row) return null;
  const u = getUserById(row.user_id);
  if (!u || u.status !== "active") return null;
  return u;
}
export function destroySession(req: Request) {
  const token = parseCookies(req)["np_session"];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(token));
}
export function destroyOtherSessions(userId: number, req: Request) {
  const token = parseCookies(req)["np_session"];
  if (token) db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(userId, sha256(token));
  else db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}
export function destroyAllSessions(userId: number) {
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const u = getSessionUser(req);
  if (!u) return res.status(401).json({ error: "请先登录" });
  (req as Request & { user: UserRow }).user = u;
  next();
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = getSessionUser(req);
  if (!u) return res.status(401).json({ error: "请先登录" });
  if (u.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  (req as Request & { user: UserRow }).user = u;
  next();
}
export const authedUser = (req: Request) => (req as Request & { user: UserRow }).user;

// ---------- 简易限流（参考程序的限流口径：按 IP 在窗口内计数）----------
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(max: number, windowMs: number, keyPrefix = "") {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyPrefix + (req.ip || "");
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.reset < now) { rec = { n: 0, reset: now + windowMs }; hits.set(key, rec); }
    rec.n += 1;
    if (rec.n > max) return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
    next();
  };
}
