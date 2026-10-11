// 分享海报 + 服务端图片代理 headless 验证（跑：node scripts/poster-proxy-headless.mjs）
// 断言：
//  1. 未登录调 /api/proxy-image → 401
//  2. 6 张外链图经代理（mock 上游：5 张返回真图字节、1 张 502）
//     → 海报 PNG 中出现 5 张真图、无任何占位块、九宫格只剩 5 格自然重排
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, globSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { chromium } from "playwright-core";

const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = "/tmp/notepro-poster-proxy-data";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

const server = spawn("node", ["dist/server/index.js"], {
  cwd: "/home/hatch/workspace/work/notepro",
  env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), SESSION_SECRET: "poster-proxy-secret", DATA_DIR: DATA, STORAGE_DIR: `${DATA}/storage` },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d.toString(); });
server.stderr.on("data", (d) => { serverLog += d.toString(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCode = () => { const m = [...serverLog.matchAll(/验证码：(\d{6})/g)]; return m.length ? m[m.length - 1][1] : ""; };

function makeClient() {
  const jar = new Map();
  const req = async (method, path, body) => {
    const headers = {};
    const c = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (c) headers.Cookie = c;
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [p] = sc.split(";"); const i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const solve = async () => {
    const ch = (await req("GET", "/api/auth/slider")).json;
    const m = ch.bg.match(/M (\d+) (\d+) h 44/);
    const v = await req("POST", "/api/auth/slider/verify", { challengeId: ch.id, x: Number(m[1]) });
    return v.json.ticket;
  };
  return { jar, req, solve };
}

// ---------- 最小 PNG 编解码 ----------
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const h = Buffer.alloc(8); h.writeUInt32BE(data.length, 0); h.write(type, 4, "ascii");
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([h, data, c]);
}
function solidPng(w, h, r, g, b) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[1 + x * 3 + 1] = g; row[1 + x * 3 + 2] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function parsePng(buf) {
  let pos = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++]; const cur = raw.subarray(p, p + stride); p += stride;
    const rec = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rec[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (f === 0) v = cur[i];
      else if (f === 1) v = cur[i] + a;
      else if (f === 2) v = cur[i] + b;
      else if (f === 3) v = cur[i] + ((a + b) >> 1);
      else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      rec[i] = v & 255;
    }
    rec.copy(out, y * stride); prev = rec;
  }
  return { w, h, bpp, data: out };
}

let fails = 0;
const expect = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) fails++;
};

async function main() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await sleep(200); }

  // 1. 未登录调代理 → 401
  const guest = makeClient();
  const r401 = await guest.req("GET", "/api/proxy-image?url=" + encodeURIComponent("https://example.com/x.png"));
  expect("未登录调 /api/proxy-image 返回 401", r401.status === 401, `status=${r401.status}`);

  // 注册登录
  const alice = makeClient();
  await alice.req("POST", "/api/auth/send-code", { email: "poster@example.com", purpose: "register", ticket: await alice.solve() });
  await sleep(150);
  const reg = await alice.req("POST", "/api/auth/register", { username: "poster", email: "poster@example.com", code: lastCode(), password: "poster123", ticket: await alice.solve() });
  expect("注册成功（自动登录）", reg.status === 200, `status=${reg.status}`);

  // 建一篇带 6 张外链图的公开独白
  const imgs = [1, 2, 3, 4, 5, 6].map((i) => `![外链图${i}](https://img.test/i${i}.png)`).join("\n\n");
  const note = await alice.req("POST", "/api/notes", { title: "海报测试", content: `海报外链图测试\n\n${imgs}`, tags: [], visibility: "public" });
  expect("建帖成功", note.status === 200, `status=${note.status}`);
  const noteId = note.json.note.id;

  // 2. headless：mock 上游 —— i6 返回 502，其余返回真图字节（纯色 PNG）
  const COLORS = { i1: [255, 0, 0], i2: [0, 255, 0], i3: [0, 0, 255], i4: [255, 255, 0], i5: [255, 0, 255] };
  const exe = globSync(process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell")[0];
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const [k, v] of alice.jar) await ctx.addCookies([{ name: k, value: v, domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.route("**/api/proxy-image**", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url") || "";
    const m = target.match(/i([1-6])\.png/);
    if (!m) return route.fulfill({ status: 502, body: "no" });
    if (m[1] === "6") return route.fulfill({ status: 502, body: "gone" }); // 第 6 张：上游已删图
    const [r, g, b] = COLORS["i" + m[1]];
    return route.fulfill({ status: 200, contentType: "image/png", body: solidPng(8, 8, r, g, b) });
  });
  await page.goto(`${BASE}/#note/${noteId}`, { waitUntil: "domcontentloaded" });
  await page.locator('article button[aria-label="分享"]').first().click();
  await page.waitForSelector(".share-poster-preview", { timeout: 90000 });
  expect("海报生成成功（非失败态）", true);
  const failVisible = await page.locator(".share-poster-fail").count();
  expect("无失败态", failVisible === 0);

  // DOM：九宫格只剩 5 张，无占位元素
  const gridCount = await page.$$eval(".poster-capture .poster-imgs img", (els) => els.length);
  expect("坏图被剔除：九宫格剩 5 张", gridCount === 5, `count=${gridCount}`);
  const nonImg = await page.$$eval(".poster-capture .poster-imgs > *", (els) => els.filter((e) => e.tagName !== "IMG").length);
  expect("九宫格无占位块（全是真 img）", nonImg === 0, `nonImg=${nonImg}`);

  // PNG 像素：5 张真图颜色全部出现、无大面积灰色占位、非空白
  const src = await page.getAttribute(".share-poster-preview", "src");
  const pngBuf = Buffer.from(src.split(",")[1], "base64");
  expect("海报 PNG 可解码", pngBuf.length > 1000, `${pngBuf.length}B`);
  const { w, h, bpp, data } = parsePng(pngBuf);
  const px = w * h;
  let sum = 0, sum2 = 0, grey = 0;
  const hits = { i1: 0, i2: 0, i3: 0, i4: 0, i5: 0 };
  for (let i = 0; i < px; i++) {
    const r = data[i * bpp], g = data[i * bpp + 1], b = data[i * bpp + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += lum; sum2 += lum * lum;
    if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && r > 90 && r < 200) grey++;
    for (const [k, [cr, cg, cb]] of Object.entries(COLORS)) if (r === cr && g === cg && b === cb) hits[k]++;
  }
  const variance = sum2 / px - (sum / px) ** 2;
  expect("海报非空白（像素方差）", variance > 200, `var=${variance.toFixed(0)}`);
  for (const [k, [cr, cg, cb]] of Object.entries(COLORS))
    expect(`真图 ${k}（rgb ${cr},${cg},${cb}）出现在 PNG`, hits[k] > 2000, `hits=${hits[k]}`);
  expect("无灰色占位块", grey / px < 0.01, `grey=${(grey / px * 100).toFixed(2)}%`);

  await browser.close();
  server.kill();
  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); server.kill(); process.exit(1); });
