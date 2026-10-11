// NotePro 渲染检查：桌面 1366 + 手机 390 横向溢出量测 + 关键交互断言
// 覆盖：颜色标记渲染/注入失效、编辑器「发布」+颜色工具+预览同步、抽屉恒高与背景锁定、
// 抽屉登录区精简、管理后台并入用户中心（#admin 深链、普通用户不可见）、我的独白更名与无标题不造假标题
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// 每个用户一个 cookie 罐的 API 客户端
function makeClient() {
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
  const register = async (username, email, password) => {
    await req("POST", "/api/auth/send-code", { email, purpose: "register", ticket: await solve() });
    await sleep(150);
    return req("POST", "/api/auth/register", { username, email, code: lastCode(), password, ticket: await solve() });
  };
  return { jar, req, register };
}

async function main() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await sleep(200); }
  let fails = 0, assertFails = 0;
  const expect = (name, cond, extra = "") => {
    console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : ` ${extra}`}`);
    if (!cond) assertFails++;
  };

  // ---------- 未设置 Logo 时的默认图标链路（真实 HTTP 响应核查） ----------
  const rawHome0 = await (await fetch(BASE + "/")).text();
  expect("默认图标：未设 Logo 时 icon 链接为随包默认图（?v=2）", rawHome0.includes('<link rel="icon" href="/favicon-32.png?v=2"'), rawHome0.slice(0, 300));
  const ico0 = await fetch(BASE + "/favicon.ico", { redirect: "manual" });
  expect("默认图标：/favicon.ico 302 跳到默认图标", ico0.status === 302 && (ico0.headers.get("location") || "").includes("/favicon-32.png"), `${ico0.status} ${ico0.headers.get("location")}`);
  const fav0 = await fetch(BASE + "/favicon-32.png");
  const fav0Buf = Buffer.from(await fav0.arrayBuffer());
  expect("默认图标：随包图标 200 且为 PNG 字节", fav0.status === 200 && (fav0.headers.get("content-type") || "").includes("png") && fav0Buf.subarray(1, 4).toString() === "PNG", `${fav0.status} ${fav0.headers.get("content-type")} ${fav0Buf.length}`);

  const admin = makeClient();
  await admin.register("render", "render@example.com", "render123");
  // 长标题帖（原有窄屏考验）
  await admin.req("POST", "/api/notes", {
    title: "一篇标题特别长的测试笔记用来检验窄屏幕上会不会把页面撑出横向滚动条来",
    content: "# 你好\n\n这是一段正文，包含一个很长的不可断行字符串 https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 以及正常中文段落。\n\n- 列表项一\n- 列表项二",
    tags: ["渲染检查", "长标签测试 abcdefghij"], visibility: "public",
  });
  // 颜色语法 + 注入用例帖
  await admin.req("POST", "/api/notes", {
    title: "颜色渲染检查",
    content: "我是[color=#e03131]中国人[/color]，这句只有后半句是红的。\n\n注入用例一 [color=#123456\" onerror=\"alert(1)]不应该生效[/color]\n\n注入用例二 [color=red]不是十六进制[/color] 与 [color=#12345]位数不对[/color] 与 <img src=\"x\" onerror=\"alert(2)\">\n\n正常嵌套 [color=#1971c2]带 `代码` 的蓝字[/color] 完。",
    tags: ["渲染检查"], visibility: "public",
  });
  // 无标题（单行正文）与有真标题各一篇：验证「我的独白」列表不造假标题
  await admin.req("POST", "/api/notes", { content: "无标题独白正文只有一行", visibility: "public" });
  await admin.req("POST", "/api/notes", { title: "有标题的独白", content: "这篇有真标题，正文是这一行。", visibility: "public" });
  // 垫高信息流，保证窄屏下页面可滚动（抽屉锁滚动断言的前置条件）
  for (let i = 1; i <= 8; i++) {
    await admin.req("POST", "/api/notes", { content: `占位独白 ${i}，用来把首页信息流撑到可滚动。`, tags: ["渲染检查"], visibility: "public" });
  }
  const bob = makeClient();
  await bob.register("bob", "bob@example.com", "bob12345");
  const adminToken = admin.jar.get("np_session");
  const bobToken = bob.jar.get("np_session");

  // ---------- 站长改名 + 上传 Logo 后：注入 HTML 与图标链路（真实 HTTP 核查） ----------
  const siteCfg = (await admin.req("GET", "/api/admin/site")).json;
  await admin.req("PUT", "/api/admin/site", { ...siteCfg, name: "渲染站" });
  const logoBytes = readFileSync(fileURLToPath(new URL("../public/favicon-32.png", import.meta.url)));
  const fd = new FormData();
  fd.append("file", new Blob([logoBytes], { type: "image/png" }), "testlogo.png");
  const upRes = await fetch(BASE + "/api/admin/logo", { method: "POST", headers: { Cookie: `np_session=${adminToken}` }, body: fd });
  const upJson = await upRes.json().catch(() => null);
  expect("后台：Logo 上传成功", upRes.status === 200 && !!upJson?.path, `${upRes.status} ${JSON.stringify(upJson)}`);
  const homeHtml = await (await fetch(BASE + "/")).text();
  expect("首屏注入：<title> 已是后台站点名", homeHtml.includes("<title>渲染站 - Jisu</title>"), homeHtml.slice(0, 300));
  expect("首屏注入：HTML 内含 window.__NP_SITE__ 真实站点名", homeHtml.includes("__NP_SITE__") && homeHtml.includes("渲染站"), "");
  const iconMatch = homeHtml.match(/<link rel="icon" href="([^"]+)"/);
  expect("首屏注入：favicon 链接指向已上传 Logo", !!iconMatch && iconMatch[1].includes("/uploads/images/"), iconMatch?.[1] || "none");
  const iconRes = await fetch(BASE + (iconMatch?.[1] || "/favicon-32.png"));
  const iconBuf = Buffer.from(await iconRes.arrayBuffer());
  expect("favicon：Logo 图标 URL 200 且为图片字节", iconRes.status === 200 && (iconRes.headers.get("content-type") || "").includes("image") && iconBuf.length > 100, `${iconRes.status} ${iconRes.headers.get("content-type")} ${iconBuf.length}B`);
  const icoRes = await fetch(BASE + "/favicon.ico", { redirect: "manual" });
  expect("/favicon.ico：302 跳到已上传 Logo", icoRes.status === 302 && (icoRes.headers.get("location") || "").includes("/uploads/images/"), `${icoRes.status} ${icoRes.headers.get("location")}`);

  const exe = globSync(process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell")[0];
  const browser = await chromium.launch({ executablePath: exe });
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

  // ---------- 桌面 1366 游客：首页 + 颜色详情渲染 ----------
  let ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(page, "home", 1366);
  const cardClean = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".note-card")].find((c) => c.textContent.includes("颜色渲染检查"));
    if (!card) return { found: false };
    const red = card.querySelector('.note-excerpt span[style*="color:#e03131"]');
    return {
      found: true,
      noMarker: !card.textContent.includes("[color=#e03131]"),
      hasText: card.textContent.includes("我是中国人"),
      redSpan: !!red,
      redText: red ? red.textContent : "",
    };
  });
  expect("游客首页：颜色帖卡片摘要带红色 span、无标记原文", cardClean.found && cardClean.noMarker && cardClean.hasText && cardClean.redSpan && cardClean.redText === "中国人", JSON.stringify(cardClean));
  await page.locator(".note-card", { hasText: "颜色渲染检查" }).first().click();
  await page.waitForTimeout(700);
  const detail = await page.evaluate(() => {
    const root = document.querySelector(".note-detail");
    if (!root) return { found: false };
    const red = root.querySelector('span[style*="color:#e03131"]');
    const blue = root.querySelector('span[style*="color:#1971c2"]');
    const eventAttrs = [...root.querySelectorAll("*")].filter((el) => [...el.attributes].some((a) => a.name.toLowerCase().startsWith("on"))).length;
    const badStyle = [...root.querySelectorAll("span")].some((s) => (s.getAttribute("style") || "").includes("onerror"));
    return {
      found: true,
      redText: red ? red.textContent : "",
      redStyle: red ? red.getAttribute("style") : "",
      blueText: blue ? blue.textContent : "",
      codeInBlue: blue ? !!blue.querySelector("code") : false,
      eventAttrs, badStyle,
      brokenImg: root.querySelectorAll('img[src="x"]').length,
      redLiteral: root.textContent.includes("[color=red]"),
      shortLiteral: root.textContent.includes("[color=#12345]"),
    };
  });
  expect("游客详情：[color] 渲染成红色 span 且文本正确", detail.found && detail.redText === "中国人" && /#e03131/.test(detail.redStyle || ""), JSON.stringify(detail));
  expect("游客详情：颜色内行内代码正常还原", detail.codeInBlue && (detail.blueText || "").includes("代码"), JSON.stringify(detail));
  expect("游客详情：注入用例全失效（无事件属性/伪造 style/坏图）", detail.eventAttrs === 0 && !detail.badStyle && detail.brokenImg === 0, JSON.stringify(detail));
  expect("游客详情：非法颜色标记按原文显示", detail.redLiteral && detail.shortLiteral, JSON.stringify(detail));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await shot(page, "login-dialog", 1366);
  const authSeg = await page.evaluate(() => {
    const seg = document.querySelector(".modal-panel .seg-fill");
    if (!seg) return null;
    const btns = [...seg.querySelectorAll("button")].map((b) => b.getBoundingClientRect().width);
    const segW = seg.getBoundingClientRect().width;
    return { btns, segW, labels: [...seg.querySelectorAll("button")].map((b) => b.textContent.trim()) };
  });
  expect("登录弹窗：三段等宽且铺满整行",
    !!authSeg && authSeg.labels.join("/") === "登录/注册/忘记密码" &&
    Math.max(...authSeg.btns) - Math.min(...authSeg.btns) < 1.5 &&
    Math.abs(authSeg.btns.reduce((a, b) => a + b, 0) - authSeg.segW) <= 2.5,
    JSON.stringify(authSeg));
  const sliderGeo = await page.evaluate(() => {
    const w = document.querySelector(".modal-panel .slider-wrap")?.getBoundingClientRect();
    const input = document.querySelector(".modal-panel .form input")?.getBoundingClientRect();
    const stage = document.querySelector(".modal-panel .slider-stage")?.getBoundingClientRect();
    return w && input && stage
      ? { w: w.width, inputW: input.width, ratio: stage.height / stage.width }
      : null;
  });
  expect("登录弹窗：滑块与表单左右对齐（等宽）、高度压扁（≈0.375）",
    !!sliderGeo && Math.abs(sliderGeo.w - sliderGeo.inputW) < 3 &&
    Math.abs(sliderGeo.ratio - 120 / 320) < 0.03, JSON.stringify(sliderGeo));
  await ctx.close();

  // ---------- 桌面 1366 管理员：菜单 / 用户中心后台标签 / 我的独白 / 编辑器 ----------
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: "np_session", value: adminToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".user-chip").click();
  await page.waitForTimeout(300);
  const menuTexts = (await page.locator(".user-menu button").allTextContents()).map((t) => t.trim());
  expect("桌面管理员：头像菜单已无「管理后台」", !menuTexts.some((t) => t.includes("管理后台")), menuTexts.join("/"));
  expect("桌面管理员：头像菜单为 用户中心/我的独白/退出登录 且无「我的笔记」残留",
    ["用户中心", "我的独白", "退出登录"].every((x) => menuTexts.some((t) => t === x)) && !menuTexts.some((t) => t.includes("我的笔记")), menuTexts.join("/"));
  await page.keyboard.press("Escape");

  await page.goto(BASE + "/#me", { waitUntil: "networkidle" });
  await shot(page, "user-center", 1366);
  const navTexts = (await page.locator(".me-nav .me-tabs > button").allTextContents()).map((t) => t.trim());
  expect("桌面管理员：用户中心标签序 个人资料/账号安全/我的独白/第三方账号/管理后台",
    JSON.stringify(navTexts) === JSON.stringify(["个人资料", "账号安全", "我的独白", "第三方账号", "管理后台"]), navTexts.join("/"));
  await page.locator(".me-nav .me-tabs > button", { hasText: "管理后台" }).click();
  await page.locator(".me-main .stat-card").first().waitFor({ timeout: 5000 }).catch(() => {});
  const segTexts = (await page.locator(".me-main .seg button").allTextContents()).map((t) => t.trim());
  expect("桌面管理员：后台六个子标签齐全", ["概览", "用户管理", "内容管理", "站点设置", "邮箱设置", "第三方登录"].every((x) => segTexts.some((t) => t === x)), segTexts.join("/"));
  const statCount = await page.locator(".me-main .stat-card").count();
  expect("桌面管理员：后台概览统计卡 8 张（功能完整，含总浏览/今日浏览）", statCount === 8, `got ${statCount}`);

  // 后台按钮行（第三方登录页）：桌面同行等高
  await page.locator(".me-main .seg button", { hasText: "第三方登录" }).click();
  await page.waitForTimeout(600);
  const dBtnRow = await page.evaluate(() => {
    const row = document.querySelector(".me-main .btn-row");
    if (!row) return null;
    return [...row.querySelectorAll(".btn")].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  });
  expect("桌面后台：保存/测试按钮同行等高", !!dBtnRow && dBtnRow.length === 2 && dBtnRow[0].h === dBtnRow[1].h && dBtnRow[0].h > 0, JSON.stringify(dBtnRow));

  await page.locator(".me-nav .me-tabs > button", { hasText: "我的独白" }).click();
  await page.waitForTimeout(600);
  const listCheck = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".my-note-item")];
    const untitled = items.find((it) => it.textContent.includes("无标题独白正文只有一行"));
    const titled = items.find((it) => it.textContent.includes("有标题的独白"));
    const colorItem = items.find((it) => it.textContent.includes("颜色渲染检查"));
    const count = (s, sub) => s.split(sub).length - 1;
    return {
      oldNameGone: !document.body.innerText.includes("我的笔记"),
      panelHeading: document.querySelector(".me-main .panel h3")?.textContent || "",
      untitledFound: !!untitled,
      untitledHasFakeTitle: untitled ? !!untitled.querySelector(".my-note-title") : null,
      untitledOccurrences: untitled ? count(untitled.textContent, "无标题独白正文只有一行") : -1,
      titledTitleText: titled ? (titled.querySelector(".my-note-title")?.textContent || "") : "",
      titledHasBody: titled ? titled.textContent.includes("这篇有真标题，正文是这一行。") : false,
      colorRedSpan: colorItem ? !!colorItem.querySelector('span[style*="color:#e03131"]') : null,
    };
  });
  expect("我的独白：面板标题已更名", listCheck.panelHeading === "我的独白", listCheck.panelHeading);
  expect("更名零残留：用户中心页无「我的笔记」文案", listCheck.oldNameGone);
  expect("我的独白：无标题笔记不造标题行", listCheck.untitledFound && listCheck.untitledHasFakeTitle === false, JSON.stringify(listCheck));
  expect("我的独白：无标题正文只出现一次（不重复）", listCheck.untitledOccurrences === 1, `occ=${listCheck.untitledOccurrences}`);
  expect("我的独白：有标题笔记标题行+预览正常", listCheck.titledTitleText.trim() === "有标题的独白" && listCheck.titledHasBody, JSON.stringify(listCheck));
  expect("我的独白：预览渲染红色 span（同一渲染器）", listCheck.colorRedSpan === true, JSON.stringify(listCheck));

  await page.goto(BASE + "/#admin", { waitUntil: "networkidle" });
  await page.locator(".me-main .stat-card").first().waitFor({ timeout: 5000 }).catch(() => {});
  await shot(page, "admin", 1366);
  const adminDeep = await page.evaluate(() => {
    const nav = [...document.querySelectorAll(".me-nav .me-tabs > button")].find((b) => b.textContent.includes("管理后台"));
    return { tabOn: !!nav && nav.classList.contains("on"), hasStats: !!document.querySelector(".me-main .stat-card") };
  });
  expect("桌面管理员：#admin 深链直达用户中心「管理后台」标签（不死链）", adminDeep.tabOn && adminDeep.hasStats, JSON.stringify(adminDeep));

  // 编辑器：发布按钮 + 字体颜色全流程 + 预览同步
  await page.goto(BASE + "/#edit", { waitUntil: "networkidle" });
  const pubBtn = page.locator(".editor-head .btn-primary");
  expect("编辑器：主按钮文案为「发布」", ((await pubBtn.textContent()) || "").trim() === "发布", (await pubBtn.textContent()) || "");
  const ta = page.locator(".editor-pane textarea");
  await ta.fill("我是中国人，要突出重点。");
  await ta.evaluate((el) => { el.focus(); el.setSelectionRange(2, 5); });
  await page.locator(".md-tool-color").click();
  await page.waitForTimeout(250);
  const popBox = await page.locator(".color-pop").boundingBox();
  expect("编辑器：色板展开且在桌面视口内", !!popBox && popBox.x >= 0 && popBox.x + popBox.width <= 1366 && popBox.y + popBox.height <= 900, JSON.stringify(popBox));
  await page.locator(".color-dot").first().click();
  const wrapped = await ta.inputValue();
  expect("编辑器：选中文字被 [color] 包裹", /我是\[color=#e03131\]中国人\[\/color\]/.test(wrapped), wrapped);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.waitForTimeout(250);
  const prevSpan = await page.evaluate(() => {
    const s = document.querySelector('.swap-preview span[style*="color:"]');
    return s ? { text: s.textContent, style: s.getAttribute("style") } : null;
  });
  expect("编辑器：预览同步渲染红色 span", !!prevSpan && prevSpan.text === "中国人" && /#e03131/.test(prevSpan.style || ""), JSON.stringify(prevSpan));
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.waitForTimeout(200);
  await ta.evaluate((el) => { el.focus(); el.setSelectionRange(0, el.value.length); });
  await page.locator(".md-tool-color").click();
  await page.waitForTimeout(200);
  await page.locator(".color-reset").click();
  const resetVal = await ta.inputValue();
  expect("编辑器：「恢复默认」剥掉颜色标记", !resetVal.includes("[color=") && resetVal.includes("我是中国人"), resetVal);
  await ta.evaluate((el) => { el.focus(); const p = el.value.length; el.setSelectionRange(p, p); });
  await page.locator(".md-tool-color").click();
  await page.waitForTimeout(200);
  await page.locator(".color-dot").nth(5).click();
  const emptyWrap = await ta.inputValue();
  expect("编辑器：无选区插入空包裹", emptyWrap.includes("[color=#1971c2][/color]"), emptyWrap);
  await ctx.close();

  // ---------- 本轮五项：OAuth 错误页 / /n 只读页 / 强调色 / 备份面板 / 浏览计数 ----------
  // 造一篇公开笔记与一篇私密笔记
  const rnPub = await admin.req("POST", "/api/notes", { title: "只读页检查帖", content: "公开正文内容", tags: [], visibility: "public" });
  const rnPriv = await admin.req("POST", "/api/notes", { title: "私密帖", content: "不公开", tags: [], visibility: "private" });
  const rnPubId = rnPub.json.note.id, rnPrivId = rnPriv.json.note.id;

  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  page = await ctx.newPage();
  // 1) OAuth 错误页：中文指引而非白屏
  await page.goto(BASE + "/api/auth/oauth/github/callback?error=redirect_uri_mismatch&error_description=x", { waitUntil: "commit" });
  const oauthErr = await page.evaluate(() => document.body.innerText);
  expect("OAuth 错误页：redirect_uri_mismatch 有中文指引", oauthErr.includes("回调地址不匹配") && oauthErr.includes("/api/auth/oauth/github/callback") && oauthErr.length > 100, oauthErr.slice(0, 80));
  await page.goto(BASE + "/api/auth/oauth/qq/callback?error=invalid_client&error_description=client%20id%20is%20illegal", { waitUntil: "commit" });
  const qqErr = await page.evaluate(() => document.body.innerText);
  expect("OAuth 错误页：QQ invalid_client 指引 App ID", qqErr.includes("纯数字 App ID"), qqErr.slice(0, 80));
  // 2) /n/<id> 真实路径只读页
  await page.goto(BASE + `/n/${rnPubId}`, { waitUntil: "networkidle" });
  await shot(page, "public-note", 1366);
  const pubPage = await page.evaluate(() => ({
    title: document.querySelector(".share-card h1")?.textContent || "",
    body: document.querySelector(".share-card .markdown")?.textContent || "",
  }));
  expect("/n/<id>：公开独白正常渲染", pubPage.title.includes("只读页检查帖") && pubPage.body.includes("公开正文内容"), JSON.stringify(pubPage));
  await page.goto(BASE + `/n/${rnPrivId}`, { waitUntil: "networkidle" });
  const privPage = await page.evaluate(() => document.body.innerText);
  expect("/n/<id>：私密笔记 404 友好页", privPage.includes("不存在或已失效"), privPage.slice(0, 60));
  // 3) 强调色：后台改色后按钮真实变色
  const siteCfg2 = (await admin.req("GET", "/api/admin/site")).json;
  await admin.req("PUT", "/api/admin/site", { ...siteCfg2, accent: "#d6336c" });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const accentBg = await page.evaluate(() => {
    const b = document.querySelector(".top-actions .btn-primary") || document.querySelector(".btn-primary");
    return b ? getComputedStyle(b).backgroundColor : "";
  });
  expect("强调色：主按钮真实变色", accentBg === "rgb(214, 51, 108)", accentBg);
  const accentStyleEl = await page.evaluate(() => document.getElementById("np-accent")?.textContent || "");
  expect("强调色：明暗两套变量齐全", accentStyleEl.includes('[data-theme="dark"]') && accentStyleEl.includes("--on-accent"), accentStyleEl.slice(0, 120));
  await admin.req("PUT", "/api/admin/site", { ...siteCfg2, accent: "" });
  await ctx.close();

  // 4+5) 后台：备份面板、QQ 指引文案、浏览数列、总浏览卡片（管理员）
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: "np_session", value: adminToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/#admin", { waitUntil: "networkidle" });
  await page.locator(".me-main .stat-card").first().waitFor({ timeout: 5000 }).catch(() => {});
  const backupPanel = await page.evaluate(() => {
    const h = [...document.querySelectorAll(".me-main .panel h3")].find((e) => e.textContent.includes("数据备份"));
    const p = h?.closest(".panel");
    return { found: !!h, btns: p ? [...p.querySelectorAll("button")].map((b) => b.textContent.trim()) : [] };
  });
  expect("后台概览：数据备份面板与导出/上传按钮", backupPanel.found && backupPanel.btns.some((t) => t.includes("导出数据库备份")) && backupPanel.btns.some((t) => t.includes("上传备份恢复")), JSON.stringify(backupPanel.btns));
  const viewCards = await page.evaluate(() => [...document.querySelectorAll(".me-main .stat-card span")].map((s) => s.textContent));
  expect("后台概览：总浏览/今日浏览卡片", viewCards.some((t) => t.includes("总浏览")) && viewCards.some((t) => t.includes("今日浏览")), viewCards.join("/"));
  // 内容管理子标签 → 浏览数列
  await page.locator(".me-nav .me-tabs > button", { hasText: "管理后台" }).click();
  await page.waitForTimeout(400);
  await page.locator(".seg-scroll button, .seg button", { hasText: "内容管理" }).first().click();
  await page.waitForTimeout(600);
  const notesTable = await page.evaluate(() => {
    const ths = [...document.querySelectorAll(".me-main table thead th")].map((t) => t.textContent.trim());
    const rows = [...document.querySelectorAll(".me-main table tbody tr")];
    const target = rows.find((r) => r.textContent.includes("只读页检查帖"));
    const idx = ths.indexOf("浏览数");
    return { ths, count: target && idx >= 0 ? target.querySelectorAll("td")[idx]?.textContent.trim() : null };
  });
  expect("后台内容管理：浏览数列且计数≥1", notesTable.ths.includes("浏览数") && Number(notesTable.count) >= 1, JSON.stringify(notesTable));
  // 第三方登录子标签 → QQ 指引文案
  await page.locator(".seg-scroll button, .seg button", { hasText: "第三方登录" }).first().click();
  await page.waitForTimeout(600);
  const qqPanel = await page.evaluate(() => document.querySelector(".me-main")?.textContent || "");
  expect("后台第三方登录：QQ 面板有 100008、网站回调域与调试QQ号指引", qqPanel.includes("100008") && qqPanel.includes("网站回调域") && qqPanel.includes("调试QQ号"), qqPanel.slice(0, 120));
  await shot(page, "admin-backup", 1366);
  await ctx.close();

  // ---------- 桌面 1366 普通用户：无后台标签，#admin 不死链 ----------
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: "np_session", value: bobToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/#me", { waitUntil: "networkidle" });
  const bobNav = (await page.locator(".me-nav .me-tabs > button").allTextContents()).map((t) => t.trim());
  expect("桌面普通用户：用户中心无「管理后台」标签", !bobNav.some((t) => t.includes("管理后台")), bobNav.join("/"));
  await page.goto(BASE + "/#admin", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const bobAdmin = await page.evaluate(() => ({
    hasAdminTab: [...document.querySelectorAll(".me-nav .me-tabs > button")].some((b) => b.textContent.includes("管理后台")),
    hasStat: !!document.querySelector(".me-main .stat-card"),
    hasProfilePanel: !!document.querySelector(".me-main .panel"),
  }));
  expect("桌面普通用户：#admin 不死链且无后台内容", !bobAdmin.hasAdminTab && !bobAdmin.hasStat && bobAdmin.hasProfilePanel, JSON.stringify(bobAdmin));
  await ctx.close();

  // ---------- 慢网首帧（/api/site 人为延迟）：品牌区第一帧即真值，不闪「己素」与蓝 N ----------
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  page = await ctx.newPage();
  await page.route("**/api/site", async (route) => { await sleep(2500); await route.continue(); });
  await page.goto(BASE + "/", { waitUntil: "commit" });
  await page.waitForSelector(".brand", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const firstPaint = await page.evaluate(() => ({
    title: document.title,
    name: document.querySelector(".brand-name")?.textContent || "",
    hasLogoImg: !!document.querySelector(".brand img.brand-logo"),
    logoSrc: document.querySelector(".brand img.brand-logo")?.getAttribute("src") || "",
    hasBadge: !!document.querySelector(".brand .brand-badge"),
    iconHref: document.querySelector('link[rel="icon"]')?.getAttribute("href") || "",
  }));
  expect("慢网首帧：标题与站名首帧即真值（不闪己素）", firstPaint.title === "渲染站 - Jisu" && firstPaint.name === "渲染站", JSON.stringify(firstPaint));
  expect("慢网首帧：品牌区首帧即站长 Logo，无蓝 N 徽章", firstPaint.hasLogoImg && firstPaint.logoSrc.includes("/uploads/images/") && !firstPaint.hasBadge, JSON.stringify(firstPaint));
  expect("慢网首帧：标签图标已指向站长 Logo", firstPaint.iconHref.includes("/uploads/images/"), firstPaint.iconHref);
  const noteList = await admin.req("GET", "/api/notes");
  const shareRes = await admin.req("GET", `/api/notes/${noteList.json.notes[0].id}/share`);
  await page.goto(BASE + `/s/${shareRes.json.token}`, { waitUntil: "commit" });
  await page.waitForSelector(".share-brand", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const shareBrand = await page.evaluate(() => ({
    name: document.querySelector(".share-brand .brand-name")?.textContent || "",
    hasImg: !!document.querySelector(".share-brand img.brand-logo"),
    hasBadge: !!document.querySelector(".share-brand .brand-badge"),
  }));
  expect("分享页慢网首帧：品牌行即真站名+Logo（不闪默认名/蓝 N）", shareBrand.name === "渲染站" && shareBrand.hasImg && !shareBrand.hasBadge, JSON.stringify(shareBrand));
  await page.unroute("**/api/site");
  await ctx.close();

  // ---------- 手机 390 管理员：常规页面 ----------
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "np_session", value: adminToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(page, "home", 390);
  await page.goto(BASE + "/#me", { waitUntil: "networkidle" });
  await shot(page, "user-center", 390);
  // 换绑邮箱弹窗：无当前密码框，只需新邮箱验证码
  await page.locator(".me-tabs > button", { hasText: "账号安全" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "换绑邮箱" }).click();
  await page.waitForTimeout(400);
  const bindModal = await page.evaluate(() => {
    const m = document.querySelector(".modal-panel");
    return m ? { hasPw: !!m.querySelector('input[type="password"]'), text: (m.textContent || "").replace(/\s+/g, "") } : null;
  });
  expect("390 账号安全：换绑邮箱弹窗无密码框、只需新邮箱验证码",
    !!bindModal && !bindModal.hasPw && bindModal.text.includes("无需输入当前密码"), JSON.stringify(bindModal));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.goto(BASE + "/#admin", { waitUntil: "networkidle" });
  await shot(page, "admin", 390);
  // 用户中心选择栏：单行横滑不折行（5 个标签同一行、容器可横滚）
  const tabStrip = await page.evaluate(() => {
    const strip = document.querySelector(".me-tabs");
    const btns = [...document.querySelectorAll(".me-tabs > button")];
    const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
    return { n: btns.length, sameRow: btns.length > 0 && new Set(tops).size === 1, sw: strip?.scrollWidth || 0, cw: strip?.clientWidth || 0 };
  });
  expect("390 用户中心：选择栏单行横滑不折行", tabStrip.n === 5 && tabStrip.sameRow && tabStrip.sw > tabStrip.cw, JSON.stringify(tabStrip));
  // 管理后台子标签：同样单行横滑
  const segRow = await page.evaluate(() => {
    const seg = document.querySelector(".me-main .seg");
    const btns = seg ? [...seg.querySelectorAll("button")] : [];
    const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
    return { n: btns.length, sameRow: btns.length > 0 && new Set(tops).size === 1, sw: seg?.scrollWidth || 0, cw: seg?.clientWidth || 0 };
  });
  expect("390 管理后台：子标签单行横滑不折行", segRow.n === 7 && segRow.sameRow && segRow.sw > segRow.cw, JSON.stringify(segRow));
  // 后台按钮行：移动端保存/测试等高且等分整行
  await page.locator(".me-main .seg button", { hasText: "第三方登录" }).click();
  await page.waitForTimeout(600);
  const mBtnRow = await page.evaluate(() => {
    const row = document.querySelector(".me-main .btn-row");
    if (!row) return null;
    return [...row.querySelectorAll(".btn")].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  });
  expect("390 后台：保存/测试按钮等高且等分整行", !!mBtnRow && mBtnRow.length === 2 && mBtnRow[0].h === mBtnRow[1].h && Math.abs(mBtnRow[0].w - mBtnRow[1].w) <= 2, JSON.stringify(mBtnRow));
  await shot(page, "admin-oauth", 390);
  // 编辑器色板在 390 下不溢出
  await page.goto(BASE + "/#edit", { waitUntil: "networkidle" });
  const mPub = page.locator(".editor-head .btn-primary");
  expect("390 编辑器：主按钮文案为「发布」", ((await mPub.textContent()) || "").trim() === "发布", (await mPub.textContent()) || "");
  await page.locator(".editor-pane textarea").fill("测试一下颜色色板在窄屏下会不会溢出，顺便写长一点触发工具栏横向滚动。");
  await page.locator(".md-tool-color").click();
  await page.waitForTimeout(250);
  const mPop = await page.locator(".color-pop").boundingBox();
  const mDots = await page.locator(".color-dot").count();
  expect("390：色板 8 色齐全且不溢出视口", mDots === 8 && !!mPop && mPop.x >= 0 && mPop.x + mPop.width <= 390, `dots=${mDots} box=${JSON.stringify(mPop)}`);
  await shot(page, "editor-color", 390);
  await page.keyboard.press("Escape");
  await ctx.close();

  // ---------- 手机 390x640 抽屉：恒高、内部滚动、背景锁定 ----------
  ctx = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "np_session", value: adminToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(250);
  const preY = await page.evaluate(() => window.scrollY);
  expect("390 抽屉：背景页面可滚动（前置条件）", preY > 0, `scrollY=${preY}`);
  const cardTopBefore = await page.evaluate(() => document.querySelector(".note-card")?.getBoundingClientRect().top);
  // 用 DOM 点击打开抽屉：Playwright 点击会先把顶栏按钮滚入视口、改变背景滚动位置，测不到真实锁定
  await page.evaluate(() => { document.querySelector('button[aria-label="打开菜单"]')?.click(); });
  await page.waitForTimeout(600);
  const userRow = await page.evaluate(() => {
    const row = document.querySelector(".drawer-user-row");
    const drawer = document.querySelector(".drawer");
    if (!row || !drawer) return null;
    const link = row.querySelector(".drawer-user-link");
    const out = row.querySelector(".drawer-logout");
    const lr = link?.getBoundingClientRect();
    const orr = out?.getBoundingClientRect();
    const dr = drawer.getBoundingClientRect();
    return {
      href: link?.getAttribute("href") || "",
      linkText: (link?.textContent || "").replace(/\s+/g, ""),
      outText: (out?.textContent || "").trim(),
      sameLine: !!lr && !!orr && Math.abs((lr.top + lr.height / 2) - (orr.top + orr.height / 2)) < 4,
      outAtRightEdge: !!orr && Math.abs(orr.right - dr.right) <= 24,
      noOldNav: !document.querySelector(".drawer .drawer-nav"),
      noUserCenterRow: ![...row.querySelectorAll("*")].some((e) => e.children.length === 0 && e.textContent.trim() === "用户中心"),
    };
  });
  expect("390 抽屉：用户区改一行（头像行进用户中心，退出登录在右缘）",
    !!userRow && userRow.href === "#me" && userRow.linkText.includes("render") && userRow.outText === "退出登录" && userRow.sameLine && userRow.outAtRightEdge && userRow.noOldNav && userRow.noUserCenterRow,
    JSON.stringify(userRow));
  const boxOf = () => page.evaluate(() => {
    const d = document.querySelector(".drawer");
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, sh: d.scrollHeight, ch: d.clientHeight };
  });
  const box1 = await boxOf();
  expect("390 抽屉：面板高度恒为视口高 640", !!box1 && Math.abs(box1.height - 640) < 1.5, JSON.stringify(box1));
  expect("390 抽屉：内容自身可滚动（前置条件）", !!box1 && box1.sh > box1.ch, JSON.stringify(box1));
  const lockState = await page.evaluate(() => ({ pos: document.body.style.position, top: document.body.style.top }));
  expect("390 抽屉：body 已 fixed 锁定并保留滚动偏移", lockState.pos === "fixed" && lockState.top === `-${preY}px`, JSON.stringify(lockState));
  // 程序化滚动：到底 → 触摸上滑 overscroll → 回顶 → 触摸下滑 overscroll，并尝试滚背景
  await page.evaluate(() => { const d = document.querySelector(".drawer"); if (d) d.scrollTop = d.scrollHeight; });
  await page.waitForTimeout(150);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x, y1, y2) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y1, id: 1 }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y1 + (y2 - y1) * i / 6), id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(150, 460, 160); await page.waitForTimeout(200);
  await page.evaluate(() => { const d = document.querySelector(".drawer"); if (d) d.scrollTop = 0; });
  await page.waitForTimeout(150);
  await swipe(150, 160, 460); await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 99999));
  await page.waitForTimeout(100);
  const box2 = await boxOf();
  const sameBox = !!box1 && !!box2 && Math.abs(box1.x - box2.x) < 1 && Math.abs(box1.y - box2.y) < 1 && Math.abs(box1.width - box2.width) < 1 && Math.abs(box1.height - box2.height) < 1;
  expect("390 抽屉：滚动+overscroll+触摸滑动后面板外框纹丝不动", sameBox, `${JSON.stringify(box1)} -> ${JSON.stringify(box2)}`);
  const cardTopDuring = await page.evaluate(() => document.querySelector(".note-card")?.getBoundingClientRect().top);
  expect("390 抽屉：打开期间背景卡片位置不动", Math.abs((cardTopDuring ?? 0) - (cardTopBefore ?? 0)) < 1, `${cardTopBefore} -> ${cardTopDuring}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const postY = await page.evaluate(() => window.scrollY);
  expect("390 抽屉：关闭后背景滚动位置精确恢复", postY === preY, `${preY} -> ${postY}`);
  // 点头像行进用户中心，并自动关抽屉
  await page.evaluate(() => { document.querySelector('button[aria-label="打开菜单"]')?.click(); });
  await page.waitForTimeout(600);
  await shot(page, "drawer-user-row", 390);
  await page.locator(".drawer-user-link").click();
  await page.waitForTimeout(800);
  const afterMe = await page.evaluate(() => ({
    hash: location.hash,
    drawerOpen: document.querySelector(".drawer-root")?.classList.contains("open"),
    hasMeNav: !!document.querySelector(".me-tabs"),
  }));
  expect("390 抽屉：点头像行进用户中心并关抽屉", afterMe.hash === "#me" && !afterMe.drawerOpen && afterMe.hasMeNav, JSON.stringify(afterMe));
  await ctx.close();

  // ---------- 手机 390x640：用户中心点汉堡只开抽屉不跳页；抽屉点日期回首页带过滤 ----------
  ctx = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "np_session", value: adminToken, domain: "127.0.0.1", path: "/" }]);
  page = await ctx.newPage();
  await page.goto(BASE + "/#me", { waitUntil: "networkidle" });
  await page.evaluate(() => { document.querySelector('button[aria-label="打开菜单"]')?.click(); });
  await page.waitForTimeout(600);
  const meDrawer = await page.evaluate(() => ({
    hash: location.hash,
    open: document.querySelector(".drawer-root")?.classList.contains("open"),
    hasMeNav: !!document.querySelector(".me-tabs"),
  }));
  expect("390 用户中心：点汉堡只开抽屉、路由仍在 #me（不跳首页）", meDrawer.open && meDrawer.hash === "#me" && meDrawer.hasMeNav, JSON.stringify(meDrawer));
  const today2 = new Date();
  const todayStr2 = `${today2.getFullYear()}-${String(today2.getMonth() + 1).padStart(2, "0")}-${String(today2.getDate()).padStart(2, "0")}`;
  await page.evaluate(() => {
    const t = [...document.querySelectorAll(".drawer .cal-day")].find((b) => b.querySelector("em"));
    t?.click();
  });
  await page.waitForTimeout(900);
  const afterPick = await page.evaluate(() => ({
    hash: location.hash,
    open: document.querySelector(".drawer-root")?.classList.contains("open"),
    sideSelected: !!document.querySelector(".side .cal-day.on"),
    toggleText: document.querySelector(".side .cal-toggle")?.textContent || "",
    cards: document.querySelectorAll(".note-card").length,
  }));
  expect("390 用户中心抽屉：点日期回首页且该日过滤生效、抽屉关闭",
    afterPick.hash.replace("#", "") === "" && !afterPick.open && afterPick.sideSelected && afterPick.toggleText.includes(todayStr2) && afterPick.cards > 0,
    JSON.stringify(afterPick));
  await ctx.close();

  // ---------- 手机 390 游客：登录入口走抽屉 ----------
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await shot(page, "login-dialog", 390);
  await ctx.close();

  await browser.close();
  server.kill("SIGTERM");
  const total = fails + assertFails;
  console.log(total === 0 ? "渲染检查：全部通过（溢出 0 + 全部断言通过）" : `渲染检查：${fails} 页溢出，${assertFails} 项断言失败`);
  process.exit(total ? 1 : 0);
}
main().catch((e) => { console.error(e); server.kill("SIGTERM"); process.exit(1); });
