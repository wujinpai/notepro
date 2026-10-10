// NotePro 渲染检查：桌面 1366 + 手机 390 量横向溢出，截核心页面
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { rmSync, mkdirSync } from "node:fs";
import { globSync } from "node:fs";

const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = "/tmp/notepro-render-data";
const OUT = "/tmp/notepro-render-shots";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
mkdirSync(OUT, { recursive: true });

const server = spawn("node", ["dist/server/index.js"], {
  cwd: "/home/hatch/workspace/work/notepro",
  env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), SESSION_SECRET: "render-secret", DATA_DIR: DATA, STORAGE_DIR: `${DATA}/storage` },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d.toString(); });
server.stderr.on("data", (d) => { log += d.toString(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCode = () => { const m = [...log.matchAll(/验证码：(\d{6})/g)]; return m.length ? m[m.length - 1][1] : ""; };

async function main() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await sleep(200); }
  // 用 API 建管理员 + 造一篇带长标题的帖（考验窄屏排版）
  const jar = new Map();
  const req = async (method, path, body) => {
    const headers = {};
    const c = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (c) headers.Cookie = c;
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [p] = sc.split(";"); const i = p.indexOf("="); jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const solve = async () => {
    const ch = (await req("GET", "/api/auth/slider")).json;
    const m = ch.bg.match(/M (\d+) (\d+) h 44/);
    const v = await req("POST", "/api/auth/slider/verify", { challengeId: ch.id, x: Number(m[1]) });
    return v.json.ticket;
  };
  await req("POST", "/api/auth/send-code", { email: "render@example.com", purpose: "register", ticket: await solve() });
  await sleep(150);
  await req("POST", "/api/auth/register", { username: "render", email: "render@example.com", code: lastCode(), password: "render123", ticket: await solve() });
  await req("POST", "/api/notes", {
    title: "一篇标题特别长的测试笔记用来检验窄屏幕上会不会把页面撑出横向滚动条来",
    content: "# 你好\n\n这是一段正文，包含一个很长的不可断行字符串 https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 以及正常中文段落。\n\n- 列表项一\n- 列表项二",
    tags: ["渲染检查", "长标签测试 abcdefghij"], visibility: "public",
  });
  const token = jar.get("np_session");

  const exe = globSync(process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell")[0];
  const browser = await chromium.launch({ executablePath: exe });
  let fails = 0;
  async function shot(page, name, width) {
    await page.waitForTimeout(600);
    const metrics = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      bodySw: document.body ? document.body.scrollWidth : 0,
    }));
    const overflow = Math.max(metrics.sw, metrics.bodySw) - metrics.cw;
    console.log(`${overflow <= 1 ? "✓" : "✗"} [${width}px] ${name} scrollWidth=${metrics.sw} bodySw=${metrics.bodySw} clientWidth=${metrics.cw}`);
    if (overflow > 1) fails++;
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
  }

  // 桌面 1366
  let ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(page, "home", 1366);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await shot(page, "login-dialog", 1366);
  await ctx.close();

  // 桌面 1366（登录态，用户中心/后台）
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: "np_session", value: token, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/#/me", { waitUntil: "networkidle" });
  await shot(page, "user-center", 1366);
  await page.goto(BASE + "/#/admin", { waitUntil: "networkidle" });
  await shot(page, "admin", 1366);
  await ctx.close();

  // 手机 390（登录态，看用户中心与后台）
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "np_session", value: token, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(page, "home", 390);
  await page.goto(BASE + "/#/me", { waitUntil: "networkidle" });
  await shot(page, "user-center", 390);
  await page.goto(BASE + "/#/admin", { waitUntil: "networkidle" });
  await shot(page, "admin", 390);
  await ctx.close();

  // 手机 390 登录弹窗（游客）
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await shot(page, "login-dialog", 390);
  await ctx.close();

  await browser.close();
  server.kill("SIGTERM");
  console.log(fails === 0 ? "渲染检查：全部通过，零横向溢出" : `渲染检查：${fails} 页存在溢出`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); server.kill("SIGTERM"); process.exit(1); });
