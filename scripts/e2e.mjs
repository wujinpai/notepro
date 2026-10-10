// NotePro 真实 HTTP E2E：临时数据目录 + 日志取码 + 本地假 OAuth 提供商（GitHub/QQ 替身端点）
import { spawn } from "node:child_process";
import http from "node:http";
import { rmSync, mkdirSync } from "node:fs";

const PORT = 3101, FAKE = 3102;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = "/tmp/notepro-e2e-data";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

// ---------- 假 OAuth 提供商（GitHub 与 QQ 双套路径）----------
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${FAKE}`);
  const json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  if (u.pathname === "/login/oauth/authorize" || u.pathname === "/oauth2.0/authorize") {
    const back = `${u.searchParams.get("redirect_uri")}?code=fake-code&state=${encodeURIComponent(u.searchParams.get("state") || "")}`;
    res.writeHead(302, { Location: back }); res.end(); return;
  }
  if (u.pathname === "/login/oauth/access_token") { json({ access_token: "fake-gh-token" }); return; }
  if (u.pathname === "/user") { json({ id: 424242, login: "octocat", name: "Fake Octo", avatar_url: "", email: "" }); return; }
  if (u.pathname === "/oauth2.0/token") { json({ access_token: "fake-qq-token", expires_in: 7776000 }); return; }
  if (u.pathname === "/oauth2.0/me") { json({ client_id: "fake-qq-appid", openid: "QQOPENID123", unionid: "QQUNION456" }); return; }
  if (u.pathname === "/user/get_user_info") { json({ ret: 0, nickname: "QQ小企鹅", figureurl_qq_2: "" }); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => fake.listen(FAKE, r));

// ---------- 启动被测服务 ----------
const server = spawn("node", ["dist/server/index.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env, NODE_ENV: "production", PORT: String(PORT), SESSION_SECRET: "e2e-test-secret",
    DATA_DIR: DATA, STORAGE_DIR: `${DATA}/storage`,
    OAUTH_GITHUB_BASE: `http://127.0.0.1:${FAKE}`, OAUTH_GITHUB_API_BASE: `http://127.0.0.1:${FAKE}`,
    OAUTH_QQ_BASE: `http://127.0.0.1:${FAKE}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d.toString(); });
server.stderr.on("data", (d) => { serverLog += d.toString(); });

function lastCode() {
  const matches = [...serverLog.matchAll(/验证码：(\d{6})/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Agent {
  constructor() { this.cookies = new Map(); }
  async req(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    let payload = body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload, redirect: opts.redirect || "manual" });
    for (const sc of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      if (i > 0) {
        const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (v) this.cookies.set(k, v); else this.cookies.delete(k);
      }
    }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  }
  get(p) { return this.req("GET", p); }
  post(p, b, o) { return this.req("POST", p, b, o); }
  put(p, b) { return this.req("PUT", p, b); }
  patch(p, b) { return this.req("PATCH", p, b); }
  del(p) { return this.req("DELETE", p); }
}

async function solveSlider(agent) {
  const ch = await agent.get("/api/auth/slider");
  const m = ch.json.bg.match(/M (\d+) (\d+) h 44/);
  if (!m) throw new Error("无法从验证图解析缺口位置");
  const v = await agent.post("/api/auth/slider/verify", { challengeId: ch.json.id, x: Number(m[1]) });
  if (!v.json?.ticket) throw new Error("滑块校验未通过：" + (v.json?.error || v.status));
  return v.json.ticket;
}
async function sendCodeAndGrab(agent, path, body, purposePath) {
  const ticket = await solveSlider(agent);
  const r = await agent.post(path, { ...body, ticket });
  await sleep(150);
  return { r, code: lastCode() };
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  // 等服务起来
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* wait */ }
    await sleep(200);
  }
  const guest = new Agent();
  const alice = new Agent();
  const aliceB = new Agent(); // alice 的第二设备
  const bob = new Agent();

  console.log("== 站点与未配置 OAuth ==");
  let site = (await guest.get("/api/site")).json;
  check("未配置时第三方按钮不出现", Array.isArray(site.oauthProviders) && site.oauthProviders.length === 0);
  let r = await guest.get("/api/auth/oauth/qq/start");
  check("未配置的 QQ 登录入口友好报错", r.status === 400 && !!r.json?.error);

  console.log("== 滑块：错位拒绝、票据一次性 ==");
  const ch0 = await guest.get("/api/auth/slider");
  const bad = await guest.post("/api/auth/slider/verify", { challengeId: ch0.json.id, x: 0 });
  check("滑块错位被拒绝", bad.status === 400);
  const t1 = await solveSlider(guest);
  const reuse1 = await guest.post("/api/auth/send-code", { email: "reuse@example.com", purpose: "reset", ticket: t1 });
  const reuse2 = await guest.post("/api/auth/send-code", { email: "reuse@example.com", purpose: "reset", ticket: t1 });
  check("滑块票据一次性（二次使用被拒）", reuse1.status === 200 && reuse2.status === 400);

  console.log("== 注册（邮箱验证码 + 滑块）→ 第一个用户是管理员 ==");
  const reg = await sendCodeAndGrab(alice, "/api/auth/send-code", { email: "alice@example.com", purpose: "register" });
  check("注册发码成功且日志取到码", reg.r.status === 200 && /^\d{6}$/.test(reg.code));
  const badCode = await alice.post("/api/auth/register", { username: "alice", email: "alice@example.com", code: "000000", password: "alice123", ticket: await solveSlider(alice) });
  check("错误验证码注册被拒", badCode.status === 400);
  r = await alice.post("/api/auth/register", { username: "alice", email: "alice@example.com", code: reg.code, password: "alice123", ticket: await solveSlider(alice) });
  check("注册成功", r.status === 200, JSON.stringify(r.json));
  check("第一个注册用户是管理员", r.json?.user?.role === "admin");
  const replay = await bob.post("/api/auth/register", { username: "alice2", email: "alice@example.com", code: reg.code, password: "alice123", ticket: await solveSlider(bob) });
  check("验证码消费后重放/邮箱重复被拒", replay.status === 409 || replay.status === 400);

  console.log("== 发帖、图片上传、广场/搜索/日历 ==");
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "pixel.png");
  const up = await alice.post("/api/upload", fd);
  check("图片上传成功", up.status === 200 && String(up.json?.path || "").startsWith("/uploads/images/"), JSON.stringify(up.json));
  const badFd = new FormData();
  badFd.append("file", new Blob(["<script>"], { type: "text/html" }), "x.html");
  const badUp = await alice.post("/api/upload", badFd);
  check("非图片上传被拒", badUp.status === 400);
  const note = await alice.post("/api/notes", {
    title: "十月施工手记", content: `# 十月\n\n今天完成了管廊支架安装。\n\n![现场](${up.json.path})\n\n**进度** 正常。`,
    tags: ["施工", "手记"], weather: "晴 24℃", location: "重庆", visibility: "public", pinned: true,
  });
  check("发帖成功", note.status === 200);
  const noteId = note.json.note.id;
  const priv = await alice.post("/api/notes", { title: "私密草稿", content: "只有自己能看", tags: ["手记"], visibility: "private" });
  check("私密帖创建成功", priv.status === 200);
  let feed = (await guest.get("/api/notes")).json;
  check("游客广场能看到公开帖且带作者/天气/位置", feed.notes.some((n) => n.id === noteId && n.author?.username === "alice" && n.weather === "晴 24℃" && n.location === "重庆"));
  check("游客广场看不到私密帖", !feed.notes.some((n) => n.id === priv.json.note.id));
  feed = (await guest.get("/api/notes?q=" + encodeURIComponent("管廊"))).json;
  check("关键词搜索可找到", feed.notes.some((n) => n.id === noteId));
  feed = (await guest.get("/api/notes?tag=" + encodeURIComponent("施工"))).json;
  check("标签筛选可找到", feed.notes.some((n) => n.id === noteId));
  const nowD = new Date();
  const month = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = `${month}-${String(nowD.getDate()).padStart(2, "0")}`;
  const cal = (await guest.get(`/api/calendar?month=${month}`)).json;
  check("日历归档今日计数 >= 1", (cal.days?.[todayStr] || 0) >= 1);
  feed = (await guest.get(`/api/notes?date=${todayStr}`)).json;
  check("点日期过滤可找到当日帖", feed.notes.some((n) => n.id === noteId));
  feed = (await alice.get("/api/notes?mine=1")).json;
  check("「我的」包含私密帖", feed.notes.some((n) => n.id === priv.json.note.id));

  console.log("== 用户中心：资料、头像、换绑、改密、会话 ==");
  r = await alice.patch("/api/me/profile", { nickname: "爱丽丝", signature: "记录每一天" });
  check("改昵称/签名成功", r.status === 200 && r.json.user.nickname === "爱丽丝");
  const afd = new FormData();
  afd.append("file", new Blob([PNG], { type: "image/png" }), "avatar.png");
  r = await alice.post("/api/me/avatar", afd);
  const me1 = (await alice.get("/api/auth/me")).json;
  check("头像上传并生效", r.status === 200 && String(me1.user.avatar).startsWith("/uploads/images/"));
  // 第二设备登录（旧密码）
  await aliceB.post("/api/auth/login", { account: "alice", password: "alice123", ticket: await solveSlider(aliceB) });
  check("第二设备可登录", (await aliceB.get("/api/auth/me")).status === 200);
  // 换绑邮箱：当前密码 + 新邮箱验证码
  const bindSend = await sendCodeAndGrab(alice, "/api/me/send-bind-code", { email: "alice2@example.com" });
  check("换绑发码成功", bindSend.r.status === 200 && /^\d{6}$/.test(bindSend.code));
  const bindBad = await alice.post("/api/me/bind-email", { email: "alice2@example.com", code: bindSend.code, password: "wrong-pass" });
  check("换绑时错密码被拒", bindBad.status === 400);
  r = await alice.post("/api/me/bind-email", { email: "alice2@example.com", code: bindSend.code, password: "alice123" });
  check("换绑邮箱成功", r.status === 200 && r.json.user.email === "alice2@example.com");
  // 改密（邮箱验证码）
  const pwSend = await sendCodeAndGrab(alice, "/api/me/send-changepw-code", {});
  check("改密发码成功", pwSend.r.status === 200 && /^\d{6}$/.test(pwSend.code));
  r = await alice.post("/api/me/change-password", { code: pwSend.code, newPassword: "alice456" });
  check("验证码改密成功", r.status === 200);
  check("改密后第二设备会话失效", (await aliceB.get("/api/auth/me")).status === 401);
  check("改密后当前会话仍可用", (await alice.get("/api/auth/me")).status === 200);
  const oldLogin = await new Agent().post("/api/auth/login", { account: "alice", password: "alice123", ticket: await solveSlider(new Agent()) });
  check("旧密码登录被拒", oldLogin.status === 401);
  // 我的笔记筛选
  const myNotes = (await alice.get("/api/me/notes?filter=private")).json;
  check("我的笔记按私密筛选正确", myNotes.notes.length === 1 && myNotes.notes[0].id === priv.json.note.id);

  console.log("== 忘记密码重置 ==");
  const resetSend = await sendCodeAndGrab(alice, "/api/auth/send-code", { email: "alice2@example.com", purpose: "reset" });
  check("找回发码成功", resetSend.r.status === 200 && /^\d{6}$/.test(resetSend.code));
  const unknownSend = await sendCodeAndGrab(new Agent(), "/api/auth/send-code", { email: "ghost@example.com", purpose: "reset" });
  check("不存在邮箱找回也返回统一成功", unknownSend.r.status === 200);
  r = await alice.post("/api/auth/reset-password", { email: "alice2@example.com", code: resetSend.code, password: "alice789", ticket: await solveSlider(alice) });
  check("验证码重置密码成功", r.status === 200);
  check("重置后全部旧会话失效", (await alice.get("/api/auth/me")).status === 401);
  const wrongCodeReset = await new Agent().post("/api/auth/reset-password", { email: "alice2@example.com", code: resetSend.code, password: "alice789", ticket: await solveSlider(new Agent()) });
  check("重置码重放被拒", wrongCodeReset.status === 400);
  const relogin = await alice.post("/api/auth/login", { account: "alice2@example.com", password: "alice789", ticket: await solveSlider(alice) });
  check("新密码可按邮箱登录", relogin.status === 200);

  console.log("== 第二用户、普通用户权限、禁用 ==");
  const reg2 = await sendCodeAndGrab(bob, "/api/auth/send-code", { email: "bob@example.com", purpose: "register" });
  r = await bob.post("/api/auth/register", { username: "bob", email: "bob@example.com", code: reg2.code, password: "bob12345", ticket: await solveSlider(bob) });
  check("第二个用户注册成功且非管理员", r.status === 200 && r.json.user.role === "user");
  const bobId = r.json.user.id;
  check("普通用户访问后台被拒", (await bob.get("/api/admin/overview")).status === 403);
  const bobNote = await bob.post("/api/notes", { title: "Bob 的公开帖", content: "大家好", tags: [], visibility: "public" });
  check("普通用户可发帖", bobNote.status === 200);
  r = await alice.patch(`/api/admin/users/${bobId}`, { status: "disabled" });
  check("管理员禁用用户成功", r.status === 200);
  check("禁用后其会话失效", (await bob.get("/api/auth/me")).status === 401);
  const bobLogin = await new Agent().post("/api/auth/login", { account: "bob", password: "bob12345", ticket: await solveSlider(new Agent()) });
  check("禁用后不可登录", bobLogin.status === 403);
  feed = (await guest.get("/api/notes")).json;
  check("禁用后其公开帖从广场下架", !feed.notes.some((n) => n.id === bobNote.json.note.id));
  await alice.patch(`/api/admin/users/${bobId}`, { status: "active" });

  console.log("== 管理员站点/内容管理 ==");
  r = await alice.put("/api/admin/site", { name: "我的站点", subtitle: "记录生活", description: "测试站点", keywords: "笔记", footer: "页脚文案", registerOpen: true, oauthShowLogin: true, url: "" });
  check("站点设置保存成功", r.status === 200);
  site = (await guest.get("/api/site")).json;
  check("前台站点信息生效", site.name === "我的站点" && site.footer === "页脚文案");
  const adminNotes = (await alice.get("/api/admin/notes")).json;
  check("内容管理可见全部笔记", adminNotes.notes.length >= 3);
  r = await alice.post(`/api/admin/notes/${noteId}/takedown`);
  feed = (await guest.get("/api/notes")).json;
  check("管理员下架后广场不可见", r.status === 200 && !feed.notes.some((n) => n.id === noteId));
  // 站点设置改回来，避免影响后续站点断言
  await alice.put("/api/admin/site", { name: "NotePro", subtitle: "", description: "", keywords: "", footer: "", registerOpen: true, oauthShowLogin: true, url: "" });

  console.log("== 分享链接：取链接→游客打开→重置失效→私密凭 token 可看 ==");
  const picPath = up.json.path;
  const sNote = await alice.post("/api/notes", {
    title: "分享测试帖", content: `正文一段\n\n![图](${picPath})`, tags: ["分享"], visibility: "public",
  });
  check("带图公开帖创建成功", sNote.status === 200 && sNote.json.note.allowComments === true);
  const sId = sNote.json.note.id;
  const gShare = await guest.get(`/api/notes/${sId}/share`);
  check("游客可取公开帖分享信息", gShare.status === 200 && !!gShare.json?.token && gShare.json?.url?.endsWith("/s/" + gShare.json.token) && gShare.json?.isAuthor === false, `${gShare.status} ${JSON.stringify(gShare.json)}`);
  const tok1 = gShare.json.token;
  const gOpen = await guest.get(`/api/share/${tok1}`);
  check("游客凭 token 打开分享内容", gOpen.status === 200 && gOpen.json.note.id === sId && gOpen.json.note.content.includes(picPath));
  r = await guest.get(`/s/${tok1}`);
  check("真实路径 /s/<token> 回 SPA 入口", r.status === 200 && r.text.includes('<div id="root">'), String(r.status));
  const gPrivShare = await guest.get(`/api/notes/${priv.json.note.id}/share`);
  check("私密帖分享信息游客不可取（404）", gPrivShare.status === 404);
  const aPrivShare = await alice.get(`/api/notes/${priv.json.note.id}/share`);
  check("私密帖作者可取分享信息", aPrivShare.status === 200 && aPrivShare.json.isAuthor === true && !!aPrivShare.json.token);
  const gPrivOpen = await guest.get(`/api/share/${aPrivShare.json.token}`);
  check("私密帖凭 token 可看", gPrivOpen.status === 200 && gPrivOpen.json.note.id === priv.json.note.id);
  check("私密帖无 token 直查仍 404", (await guest.get(`/api/notes/${priv.json.note.id}`)).status === 404);
  r = await new Agent().post(`/api/notes/${sId}/share/reset`);
  check("未登录重置分享链接被拒", r.status === 401);
  const aliceResetBob = await alice.post(`/api/notes/${bobNote.json.note.id}/share/reset`);
  check("非作者重置他人的分享链接被拒", aliceResetBob.status === 404);
  const aReset = await alice.post(`/api/notes/${sId}/share/reset`);
  check("作者重置分享链接成功且换新 token", aReset.status === 200 && !!aReset.json.token && aReset.json.token !== tok1);
  check("重置后旧链接立即失效", (await guest.get(`/api/share/${tok1}`)).status === 404);
  check("重置后新链接可用", (await guest.get(`/api/share/${aReset.json.token}`)).status === 200);
  check("不存在的 token 回 404 友好错误", (await guest.get("/api/share/deadbeefdeadbeefdeadbeef")).status === 404);

  console.log("== 评论：发表/计数/关开关/三方删除权限 ==");
  const bobL = new Agent();
  r = await bobL.post("/api/auth/login", { account: "bob", password: "bob12345", ticket: await solveSlider(new Agent()) });
  check("bob 重新登录成功", r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  const guestPost = await new Agent().post(`/api/notes/${sId}/comments`, { content: "游客评论" });
  check("未登录发表评论 401", guestPost.status === 401);
  const c1 = await bobL.post(`/api/notes/${sId}/comments`, { content: "写得不错 <script>alert(1)</script>" });
  check("登录用户发表评论成功（正文原样存储，前台按文本渲染）", c1.status === 200 && c1.json.comment.content.includes("<script>"));
  const c1Id = c1.json.comment.id;
  feed = (await guest.get("/api/notes")).json;
  check("广场卡片评论计数 +1", feed.notes.find((n) => n.id === sId)?.commentCount === 1, JSON.stringify(feed.notes.find((n) => n.id === sId)));
  const longPost = await bobL.post(`/api/notes/${sId}/comments`, { content: "评".repeat(501) });
  check("超 500 字评论被拒", longPost.status === 400);
  const emptyPost = await bobL.post(`/api/notes/${sId}/comments`, { content: "   " });
  check("空评论被拒", emptyPost.status === 400);
  let clist = (await guest.get(`/api/notes/${sId}/comments`)).json;
  check("游客可读公开帖评论列表", clist.allowComments === true && clist.total === 1 && clist.comments[0].author?.username === "bob");
  // bob 删 alice 在自己帖下的评论 → 无权
  const cAlice = await alice.post(`/api/notes/${sId}/comments`, { content: "作者自评" });
  const bobDelAlice = await bobL.del(`/api/comments/${cAlice.json.comment.id}`);
  check("普通用户删他人评论被拒", bobDelAlice.status === 403);
  // 作者删 bob 的评论（笔记作者维度）
  const aliceDelBob = await alice.del(`/api/comments/${c1Id}`);
  check("笔记作者可删评论", aliceDelBob.status === 200);
  clist = (await guest.get(`/api/notes/${sId}/comments`)).json;
  check("删除后列表仅剩作者自评", clist.total === 1 && clist.comments[0].userId === cAlice.json.comment.userId);
  // 管理员删 bob 在自家帖下的评论（管理员维度，alice 非该帖作者）
  const cBob2 = await bobL.post(`/api/notes/${bobNote.json.note.id}/comments`, { content: "自家帖评论" });
  const bobDelOwn = await bobL.del(`/api/comments/${cBob2.json.comment.id}`);
  check("评论者本人可删自己的评论", bobDelOwn.status === 200);
  const cBob3 = await bobL.post(`/api/notes/${bobNote.json.note.id}/comments`, { content: "再评一条" });
  const adminDel = await alice.del(`/api/comments/${cBob3.json.comment.id}`);
  check("管理员可删任意评论", adminDel.status === 200);
  // 关闭评论：发表被拒、列表隐藏、卡片计数口径不变（数据保留）
  const upd = await alice.put(`/api/notes/${sId}`, { allowComments: false });
  check("作者关闭评论成功", upd.status === 200 && upd.json.note.allowComments === false);
  const closedPost = await bobL.post(`/api/notes/${sId}/comments`, { content: "关了还评" });
  check("关闭后发表被拒且错误可读", closedPost.status === 403 && /关闭/.test(closedPost.json?.error || ""), `${closedPost.status} ${closedPost.json?.error || ""}`);
  clist = (await guest.get(`/api/notes/${sId}/comments`)).json;
  check("关闭后评论列表隐藏", clist.allowComments === false && clist.total === 0);
  feed = (await guest.get("/api/notes")).json;
  check("关闭后卡片评论数口径保留实际条数", feed.notes.find((n) => n.id === sId)?.commentCount === 1);
  const reopen = await alice.put(`/api/notes/${sId}`, { allowComments: true });
  clist = (await guest.get(`/api/notes/${sId}/comments`)).json;
  check("重新打开恢复显示已有评论", reopen.json.note.allowComments === true && clist.total === 1);

  console.log("== 管理员 SMTP 设置：遮罩、留空不改、坏主机可读失败 ==");
  r = await alice.put("/api/admin/smtp", { host: "127.0.0.1", port: 1, secure: false, user: "boss@test.cn", pass: "smtp-secret-1", from: "boss@test.cn", fromName: "测试站", enabled: true });
  check("SMTP 保存成功", r.status === 200);
  let smtp = (await alice.get("/api/admin/smtp")).json;
  check("GET 只回 hasPass 不回明文", smtp.hasPass === true && !("pass" in smtp) && !JSON.stringify(smtp).includes("smtp-secret-1"));
  r = await alice.put("/api/admin/smtp", { host: "127.0.0.1", port: 1, secure: false, user: "boss@test.cn", from: "boss@test.cn", fromName: "测试站", enabled: true });
  smtp = (await alice.get("/api/admin/smtp")).json;
  check("密码留空不改仍保留 hasPass", smtp.hasPass === true);
  r = await alice.post("/api/admin/smtp/test", { to: "someone@example.com" });
  check("坏主机测试邮件返回可读失败", r.status === 502 && /失败/.test(r.json?.error || ""), `${r.status} ${r.json?.error || ""}`);
  check("测试失败信息不含密码", !String(r.json?.error || "").includes("smtp-secret-1"));
  await alice.put("/api/admin/smtp", { host: "", port: 465, secure: true, user: "", from: "", fromName: "", enabled: false });

  console.log("== 第三方设置与 GitHub/QQ 本地替身全流程 ==");
  r = await alice.put("/api/admin/oauth/github", { enabled: true, clientId: "fake-gh-id", secret: "fake-gh-secret" });
  check("GitHub 设置保存成功", r.status === 200);
  const oauthCfg = (await alice.get("/api/admin/oauth")).json;
  check("GitHub GET 不回密钥明文且回调地址正确",
    oauthCfg.providers.github.hasSecret === true && oauthCfg.providers.github.clientId === "fake-gh-id"
    && !JSON.stringify(oauthCfg).includes("fake-gh-secret")
    && oauthCfg.providers.github.callback.endsWith("/api/auth/oauth/github/callback"));
  const testCfg = await alice.post("/api/admin/oauth/test", { provider: "github" });
  check("第三方「测试配置」校验通过", testCfg.status === 200);
  site = (await guest.get("/api/site")).json;
  check("配置启用后前台显示 GitHub 入口", site.oauthProviders.includes("github"));

  // GitHub 授权跳转参数
  const start = await guest.get("/api/auth/oauth/github/start");
  const loc = start.headers.get("location") || "";
  check("GitHub 授权跳转域名正确", loc.startsWith(`http://127.0.0.1:${FAKE}/login/oauth/authorize`), loc);
  const locUrl = new URL(loc);
  check("授权参数 client_id/redirect_uri/state 正确",
    locUrl.searchParams.get("client_id") === "fake-gh-id"
    && (locUrl.searchParams.get("redirect_uri") || "").endsWith("/api/auth/oauth/github/callback")
    && !!locUrl.searchParams.get("state"));
  // 跟随假提供商 → 回到本站回调 → 自动建号登录
  const ghUser = new Agent();
  const rr = await fetch(loc, { redirect: "manual" });
  const callbackUrl = rr.headers.get("location") || "";
  check("假提供商回调到本站", callbackUrl.startsWith(`${BASE}/api/auth/oauth/github/callback`), callbackUrl);
  const cb = await ghUser.req("GET", callbackUrl.replace(BASE, ""), undefined, {});
  check("回调完成并跳回前台", cb.status === 302 && (cb.headers.get("location") || "").includes("oauth=ok"), `${cb.status} ${cb.headers.get("location")}`);
  const ghMe = (await ghUser.get("/api/auth/me")).json;
  check("GitHub 替身登录成功且自动建号", ghMe.user?.nickname === "Fake Octo" && /^gh_/.test(ghMe.user?.username || ""), JSON.stringify(ghMe));
  const ghBound = (await ghUser.get("/api/me/oauth")).json;
  check("GitHub 绑定关系已建立", ghBound.bound.some((b) => b.provider === "github"));

  // QQ 同理
  await alice.put("/api/admin/oauth/qq", { enabled: true, clientId: "fake-qq-appid", secret: "fake-qq-secret" });
  const qqUser = new Agent();
  const qqStart = await qqUser.get("/api/auth/oauth/qq/start");
  const qqLoc = qqStart.headers.get("location") || "";
  check("QQ 授权跳转生成正确", qqLoc.startsWith(`http://127.0.0.1:${FAKE}/oauth2.0/authorize`) && new URL(qqLoc).searchParams.get("client_id") === "fake-qq-appid", qqLoc);
  const qqAuthz = await fetch(qqLoc, { redirect: "manual" });
  const qqCallback = qqAuthz.headers.get("location") || "";
  const qqCb = await qqUser.req("GET", qqCallback.replace(BASE, ""), undefined, {});
  const qqMe = (await qqUser.get("/api/auth/me")).json;
  check("QQ 替身登录成功且自动建号（unionid 已存）", qqCb.status === 302 && qqMe.user?.nickname === "QQ小企鹅" && /^qq_/.test(qqMe.user?.username || ""), JSON.stringify(qqMe));
  // QQ 用户绑定邮箱后，后台可见其第三方标识
  const overview = (await alice.get("/api/admin/overview")).json;
  check("概览计数正确（用户>=3、绑定>=2）", overview.users >= 3 && overview.oauthBindings >= 2, JSON.stringify(overview));

  // 已登录用户绑定/解绑第三方
  const bindStart = await alice.get("/api/auth/oauth/qq/start?bind=1");
  const bindLoc = bindStart.headers.get("location") || "";
  const bindAuthz = await fetch(bindLoc, { redirect: "manual" });
  const bindCbUrl = bindAuthz.headers.get("location") || "";
  // QQ openid 已被 qqUser 占用，alice 绑定同一 QQ 应报错友好
  const bindCb = await alice.req("GET", bindCbUrl.replace(BASE, ""), undefined, {});
  check("重复绑定他人第三方账号被友好拦截", (bindCb.headers.get("location") || "").includes("oauth_msg"), bindCb.headers.get("location") || "");

  console.log(`\nE2E 结果：${passed} 通过，${failed} 失败`);
  if (failures.length) console.log("失败项：" + failures.join("；"));
  server.kill("SIGTERM");
  fake.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E 异常：", e);
  console.log("--- 服务端日志尾部 ---\n" + serverLog.slice(-3000));
  server.kill("SIGTERM");
  fake.close();
  process.exit(1);
});
