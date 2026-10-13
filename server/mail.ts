import nodemailer from "nodemailer";
import { db, getSetting, setSetting } from "./db.js";
import { encryptSecret, decryptSecret, sha256, randomToken } from "./util.js";

// ---------- SMTP 配置（后台优先 → env 回退）----------
export interface SmtpConfig {
  host: string; port: number; secure: boolean; user: string; pass: string;
  from: string; fromName: string; enabled: boolean;
}
export function getSmtpConfig(): SmtpConfig | null {
  const enabled = getSetting("smtp_enabled") === "1";
  const host = getSetting("smtp_host");
  const user = getSetting("smtp_user");
  if (enabled && host && user) {
    return {
      host,
      port: Number(getSetting("smtp_port", "465")) || 465,
      secure: getSetting("smtp_secure", "1") === "1",
      user,
      pass: decryptSecret(getSetting("smtp_pass_enc")),
      from: getSetting("smtp_from") || user,
      fromName: getSetting("smtp_from_name"),
      enabled: true,
    };
  }
  const eHost = process.env.SMTP_HOST || "";
  const eUser = process.env.SMTP_USER || "";
  if (eHost && eUser) {
    return {
      host: eHost,
      port: Number(process.env.SMTP_PORT || "465") || 465,
      secure: (process.env.SMTP_SECURE || "true") !== "false",
      user: eUser,
      pass: process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || eUser,
      fromName: process.env.SMTP_FROM_NAME || "",
      enabled: true,
    };
  }
  return null;
}

const PURPOSE_LABEL: Record<string, string> = {
  register: "注册账号",
  reset: "重置密码",
  bind: "绑定邮箱",
  changepw: "修改密码",
};

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<{ ok: boolean; error?: string; logged?: boolean }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    console.log(`[email-code] SMTP 未配置，邮件本应发送至 ${to}：${subject} | ${text}`);
    return { ok: true, logged: true };
  }
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    const from = cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from;
    await transport.sendMail({ from, to, subject, text, html: html || text });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------- 邮箱验证码：6 位 / 10 分钟 / 60 秒重发，purpose 隔离 ----------
export async function sendEmailCode(email: string, purpose: string): Promise<{ ok: boolean; error?: string; retryAfter?: number }> {
  const now = Date.now();
  const last = db.prepare("SELECT created_at FROM email_codes WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1")
    .get(email, purpose) as { created_at: number } | undefined;
  if (last && now - last.created_at < 60_000) {
    return { ok: false, error: "发送过于频繁，请 60 秒后再试", retryAfter: Math.ceil((60_000 - (now - last.created_at)) / 1000) };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare("INSERT INTO email_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .run(email, purpose, sha256(`${email}|${purpose}|${code}`), now + 10 * 60_000, now);
  const label = PURPOSE_LABEL[purpose] || "验证";
  const site = getSetting("site_name", "己素");
  const fromName = (() => { const c = getSmtpConfig(); return c?.fromName || site; })();
  const subject = `${fromName} · ${label}验证码`;
  const text = `您正在${label}，验证码是 ${code}（10 分钟内有效）。如非本人操作请忽略。`;
  const html = `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:560px;margin:0 auto;border:1px solid #dadce0;padding:24px">
  <h2 style="color:#1a73e8;margin:0 0 12px">${site} · ${label}验证码</h2>
  <p style="color:#3c4043;font-size:14px">您正在${label}，验证码是：</p>
  <p style="font-size:28px;letter-spacing:6px;color:#202124;margin:12px 0"><strong>${code}</strong></p>
  <p style="color:#80868b;font-size:12px">10 分钟内有效。如非本人操作，请忽略本邮件。</p></div>`;
  const r = await sendMail(email, subject, text, html);
  if (!r.ok) return { ok: false, error: `邮件发送失败：${r.error}` };
  if (r.logged) console.log(`[email-code] ${email} (${purpose}) 验证码：${code}`);
  return { ok: true };
}

export function verifyEmailCode(email: string, purpose: string, code: string): boolean {
  const row = db.prepare("SELECT id FROM email_codes WHERE email=? AND purpose=? AND code_hash=? AND consumed=0 AND expires_at>? ORDER BY id DESC LIMIT 1")
    .get(email, purpose, sha256(`${email}|${purpose}|${code}`), Date.now()) as { id: number } | undefined;
  if (!row) return false;
  db.prepare("UPDATE email_codes SET consumed=1 WHERE id=?").run(row.id);
  return true;
}

// ---------- 滑块拼图：SVG 背景（带缺口）+ 滑块块，答案不下发 ----------
export const SLIDER_W = 320;
export const SLIDER_H = 160;
export const PIECE = 44;

const SLIDER_COLORS = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#9aa0a6", "#5f6368"];
function scenery(seed: number): string {
  // 用简单 LCG 生成可复现的几何背景纹样（圆/矩形），缺口填色固定 #202124 描边白
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let shapes = "";
  for (let i = 0; i < 14; i++) {
    const c = SLIDER_COLORS[Math.floor(rnd() * SLIDER_COLORS.length)];
    if (rnd() > 0.5) {
      shapes += `<circle cx="${Math.floor(rnd() * SLIDER_W)}" cy="${Math.floor(rnd() * SLIDER_H)}" r="${8 + Math.floor(rnd() * 26)}" fill="${c}" opacity="0.55"/>`;
    } else {
      shapes += `<rect x="${Math.floor(rnd() * (SLIDER_W - 60))}" y="${Math.floor(rnd() * (SLIDER_H - 40))}" width="${24 + Math.floor(rnd() * 60)}" height="${16 + Math.floor(rnd() * 40)}" fill="${c}" opacity="0.5"/>`;
    }
  }
  return shapes;
}

export function createSliderChallenge(): { id: string; bg: string; piece: string; y: number } {
  const id = randomToken(12);
  const answer = 40 + Math.floor(Math.random() * (SLIDER_W - PIECE - 60));
  const seed = Math.floor(Math.random() * 1e9);
  db.prepare("INSERT INTO slider_challenges(id,answer,expires_at) VALUES(?,?,?)").run(id, answer, Date.now() + 5 * 60_000);
  const py = 30 + Math.floor(Math.random() * (SLIDER_H - PIECE - 60));
  const shapes = scenery(seed);
  const gapPath = `M ${answer} ${py} h ${PIECE} v ${PIECE} h -${PIECE} Z`;
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDER_W}" height="${SLIDER_H}" viewBox="0 0 ${SLIDER_W} ${SLIDER_H}">
<rect width="${SLIDER_W}" height="${SLIDER_H}" fill="#e8f0fe"/>${shapes}
<path d="${gapPath}" fill="#202124" opacity="0.85" stroke="#ffffff" stroke-width="2"/></svg>`;
  const piece = `<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE}" height="${PIECE}" viewBox="0 0 ${PIECE} ${PIECE}">
<svg x="${-answer}" y="${-py}" width="${SLIDER_W}" height="${SLIDER_H}"><rect width="${SLIDER_W}" height="${SLIDER_H}" fill="#e8f0fe"/>${shapes}</svg>
<path d="M 0 0 h ${PIECE} v ${PIECE} h -${PIECE} Z" fill="none" stroke="#ffffff" stroke-width="2"/></svg>`;
  return { id, bg, piece, y: py };
}

export function verifySlider(challengeId: string, x: number): { ok: boolean; ticket?: string; error?: string } {
  const row = db.prepare("SELECT answer, expires_at, used FROM slider_challenges WHERE id=?").get(challengeId) as
    { answer: number; expires_at: number; used: number } | undefined;
  if (!row || row.used || row.expires_at < Date.now()) return { ok: false, error: "滑块验证已过期，请刷新" };
  db.prepare("UPDATE slider_challenges SET used=1 WHERE id=?").run(challengeId);
  if (Math.abs(x - row.answer) > 8) return { ok: false, error: "滑块位置不正确，请重试" };
  const ticket = randomToken(24);
  db.prepare("INSERT INTO tickets(token,expires_at) VALUES(?,?)").run(ticket, Date.now() + 5 * 60_000);
  return { ok: true, ticket };
}

export function consumeTicket(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare("SELECT expires_at, consumed FROM tickets WHERE token=?").get(token) as
    { expires_at: number; consumed: number } | undefined;
  if (!row || row.consumed || row.expires_at < Date.now()) return false;
  db.prepare("UPDATE tickets SET consumed=1 WHERE token=?").run(token);
  return true;
}

// ---------- 点字验证（替代滑块）：点击图片中指定的汉字 ----------
export const WORD_W = 300;
export const WORD_H = 140;
const WORD_CHARS = ["人","大","小","中","上","下","左","右","天","地","日","月","水","火","木","金","土","好","学","乐","爱","心","手","目","耳","口","山","石","田","力"];
const WORD_COUNT = 6;      // 图中总字数
const WORD_TARGET = 3;     // 需按序点击的字数
const WORD_TOL = 26;       // 点击容差（像素）

export function createWordChallenge(): { id: string; svg: string; targets: string[] } {
  const id = randomToken(12);
  // 随机选 6 个不重复的字
  const pool = [...WORD_CHARS].sort(() => Math.random() - 0.5);
  const chars = pool.slice(0, WORD_COUNT);
  // 随机选 3 个作为目标（按在 chars 中的随机顺序）
  const idxs = [...Array(WORD_COUNT).keys()].sort(() => Math.random() - 0.5).slice(0, WORD_TARGET);
  const targets = idxs.map(i => chars[i]);
  // 随机位置（避免重叠）：6 个字分两行，每行 3 个，x 在列内随机，y 在行内随机
  const placed: { ch: string; x: number; y: number }[] = [];
  const cols = 3, rows = 2;
  const cw = WORD_W / cols, rh = WORD_H / rows;
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(c * cw + 18 + Math.random() * (cw - 52));
      const y = Math.floor(r * rh + 34 + Math.random() * (rh - 58));
      placed.push({ ch: chars[k++], x, y });
    }
  }
  // 背景点缀
  let deco = "";
  const rnd = Math.random;
  for (let i = 0; i < 8; i++) {
    deco += `<circle cx="${Math.floor(rnd() * WORD_W)}" cy="${Math.floor(rnd() * WORD_H)}" r="${3 + Math.floor(rnd() * 8)}" fill="#dbe7f5" opacity="0.7"/>`;
  }
  const texts = placed.map(p =>
    `<text x="${p.x}" y="${p.y}" font-size="30" fill="#1a1a1a" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${p.ch}</text>`
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WORD_W}" height="${WORD_H}" viewBox="0 0 ${WORD_W} ${WORD_H}"><rect width="${WORD_W}" height="${WORD_H}" fill="#f2f6fc"/>${deco}${texts}</svg>`;
  db.prepare("INSERT INTO word_challenges(id,chars_json,targets_json,expires_at) VALUES(?,?,?,?)")
    .run(id, JSON.stringify(placed), JSON.stringify(targets), Date.now() + 5 * 60_000);
  return { id, svg, targets };
}

export function verifyWord(challengeId: string, points: { x: number; y: number }[]): { ok: boolean; ticket?: string; error?: string } {
  const row = db.prepare("SELECT chars_json, targets_json, expires_at, used FROM word_challenges WHERE id=?").get(challengeId) as
    { chars_json: string; targets_json: string; expires_at: number; used: number } | undefined;
  if (!row || row.used || row.expires_at < Date.now()) return { ok: false, error: "验证已过期，请刷新" };
  db.prepare("UPDATE word_challenges SET used=1 WHERE id=?").run(challengeId);
  let placed: { ch: string; x: number; y: number }[];
  let targets: string[];
  try {
    placed = JSON.parse(row.chars_json);
    targets = JSON.parse(row.targets_json);
  } catch {
    return { ok: false, error: "验证数据异常，请刷新" };
  }
  if (!Array.isArray(points) || points.length !== targets.length) return { ok: false, error: "请按顺序点击全部指定文字" };
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const pos = placed.find(p => p.ch === t);
    const pt = points[i];
    if (!pos || typeof pt?.x !== "number" || typeof pt?.y !== "number") return { ok: false, error: "点击顺序不正确，请重试" };
    const dx = pt.x - pos.x, dy = pt.y - pos.y;
    if (dx * dx + dy * dy > WORD_TOL * WORD_TOL) return { ok: false, error: "点击位置不正确，请重试" };
  }
  const ticket = randomToken(24);
  db.prepare("INSERT INTO tickets(token,expires_at) VALUES(?,?)").run(ticket, Date.now() + 5 * 60_000);
  return { ok: true, ticket };
}

export { setSetting, encryptSecret };
