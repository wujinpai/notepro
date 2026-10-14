// Canvas 手绘分享海报：不依赖 html-to-image / SVG foreignObject，
// 在各浏览器（iOS Safari、微信 WebView、桌面 Chrome）表现一致。
// 布局复刻 CSS 版海报：750pt 宽，2x 绘制。

export interface PosterNote {
  title: string;
  content: string;
  tags: string[];
  weather: string;
  location: string;
  createdAt: number;
  author: { nickname: string; username: string; avatar: string } | null;
}

export interface PosterAssets {
  images: (ImageBitmap | HTMLImageElement)[]; // 内容图（按显示顺序，最多 9 张）
  avatar: ImageBitmap | HTMLImageElement | null;
  qr: ImageBitmap | HTMLImageElement | null;
}

const S = 2; // 绘制倍率
const W = 750 * S;
const PAD = 48 * S;
const CW = W - PAD * 2; // 内容宽 1308
const INK = "#3d3830";
const MUTED = "#8a8478";
const BG = "#fffdf8";

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 按字符换行（中文友好），返回行数组
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    const t = line + ch;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = ch; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// 纯文本摘要（去 markdown 语法），复刻 excerpt() 的截断口径
export function plainExcerpt(content: string, n = 300): string {
  const t = (content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[color=#[0-9a-fA-F]{6}\]([^\n]*?)\[\/color\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function drawCover(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap | HTMLImageElement,
  x: number, y: number, w: number, h: number, r: number
) {
  const iw = (img as ImageBitmap).width || (img as HTMLImageElement).naturalWidth;
  const ih = (img as ImageBitmap).height || (img as HTMLImageElement).naturalHeight;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s, sh = h / s;
  const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

export async function renderPoster(
  note: PosterNote,
  brand: string,
  assets: PosterAssets
): Promise<string> {
  // ---- 先排版，计算总高度 ----
  const meas = document.createElement("canvas").getContext("2d")!;
  const font = (px: number, weight = 400) => `${weight} ${px * S}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

  const nickname = note.author?.nickname || "用户";
  const sub = `@${note.author?.username || ""} · ${fmtTime(note.createdAt)}`;
  const env = [note.weather, note.location].filter(Boolean).join(" · ");
  const excerpt = plainExcerpt(note.content);
  const title = (note.title || "").trim();

  meas.font = font(30);
  const excerptLines = excerpt ? wrapText(meas, excerpt, CW) : [];
  meas.font = font(34, 600);
  const titleLines = title ? wrapText(meas, title, CW) : [];

  const n = Math.min(9, assets.images.length);
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const gap = 10 * S;
  let gridH = 0;
  let cell = 0;
  if (n > 0) {
    if (cols === 1) {
      const im = assets.images[0];
      const iw = (im as ImageBitmap).width || 4, ih = (im as ImageBitmap).height || 3;
      cell = CW;
      gridH = Math.min(520 * S, Math.round((CW * ih) / iw));
    } else {
      cell = Math.floor((CW - gap * (cols - 1)) / cols);
      gridH = cell * Math.ceil(n / cols) + gap * (Math.ceil(n / cols) - 1);
    }
  }

  const hasQr = !!assets.qr;
  const footH = hasQr ? 220 * S : 0;

  let y = PAD;
  y += 96 * S; // 头像行
  if (env) y += 22 * S + 28 * S; // 间距 + 环境行
  if (titleLines.length) y += 18 * S + titleLines.length * 44 * S * 1.35;
  if (excerptLines.length) y += 20 * S + excerptLines.length * 30 * S * 1.6;
  if (n > 0) y += 26 * S + gridH;
  if (note.tags.length) y += 24 * S + 40 * S;
  if (hasQr) y += 30 * S + footH;
  y += PAD;
  const H = Math.ceil(y);

  // ---- 绘制 ----
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = BG;
  rr(ctx, 0, 0, W, H, 20 * S);
  ctx.fill();

  let cy = PAD;
  // 头像
  const avR = 48 * S, avX = PAD + avR, avY = cy + avR;
  if (assets.avatar) {
    ctx.save();
    ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.clip();
    await drawCover(ctx, assets.avatar, avX - avR, avY - avR, avR * 2, avR * 2, 0).catch(() => {});
    ctx.restore();
  } else {
    ctx.fillStyle = "#e8e2d4";
    ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = font(40, 600);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(nickname.slice(0, 1).toUpperCase(), avX, avY + 2 * S);
  }
  // 昵称 + 时间
  const tx = PAD + 96 * S + 22 * S;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = font(38, 600);
  ctx.fillText(nickname, tx, cy + 52 * S);
  ctx.fillStyle = MUTED;
  ctx.font = font(26);
  ctx.fillText(sub, tx, cy + 84 * S);
  cy += 96 * S;

  // 天气/位置
  if (env) {
    cy += 22 * S;
    ctx.fillStyle = MUTED;
    ctx.font = font(28);
    ctx.fillText(env, PAD, cy + 22 * S);
    cy += 28 * S;
  }

  // 标题
  if (titleLines.length) {
    cy += 18 * S;
    ctx.fillStyle = INK;
    ctx.font = font(34, 600);
    for (const ln of titleLines) { ctx.fillText(ln, PAD, cy + 34 * S); cy += 44 * S * 1.35; }
  }

  // 正文
  if (excerptLines.length) {
    cy += 20 * S;
    ctx.fillStyle = INK;
    ctx.font = font(30);
    for (const ln of excerptLines) { ctx.fillText(ln, PAD, cy + 30 * S); cy += 30 * S * 1.6; }
  }

  // 图片九宫格
  if (n > 0) {
    cy += 26 * S;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = PAD + c * (cell + gap);
      const yy = cy + r * (cell + gap);
      const w = cols === 1 ? CW : cell;
      const h = cols === 1 ? gridH : cell;
      try { await drawCover(ctx, assets.images[i], x, yy, w, h, 12 * S); } catch { /* 跳过坏图 */ }
    }
    cy += gridH;
  }

  // 标签
  if (note.tags.length) {
    cy += 24 * S;
    ctx.font = font(26);
    let tx2 = PAD;
    const tagH = 40 * S;
    for (const t of note.tags.slice(0, 6)) {
      const label = `#${t}`;
      const tw = ctx.measureText(label).width + 28 * S;
      if (tx2 + tw > PAD + CW) break;
      ctx.fillStyle = "#eaf1f9";
      rr(ctx, tx2, cy, tw, tagH, 14 * S);
      ctx.fill();
      ctx.fillStyle = "#1971c2";
      ctx.fillText(label, tx2 + 14 * S, cy + 28 * S);
      tx2 += tw + 12 * S;
    }
    cy += tagH;
  }

  // 页脚：品牌 + 二维码
  if (hasQr) {
    cy += 30 * S;
    ctx.fillStyle = MUTED;
    ctx.font = font(28);
    const brandText = brand || "己素 · 笔墨留香";
    // 品牌文字垂直居中于二维码
    ctx.fillText(brandText, PAD, cy + 110 * S);
    const qrSize = 200 * S;
    const qx = PAD + CW - qrSize, qy = cy;
    try { ctx.drawImage(assets.qr!, qx, qy, qrSize, qrSize); } catch { /* ignore */ }
    ctx.fillStyle = MUTED;
    ctx.font = font(22);
    ctx.textAlign = "center";
    ctx.fillText("扫码打开这篇独白", qx + qrSize / 2, qy + qrSize + 28 * S);
    ctx.textAlign = "left";
    cy += footH;
  }

  cy += PAD;
  return cv.toDataURL("image/png");
}

// 加载图片：fetch 取字节（外链已转同源代理），优先用 HTMLImageElement 解码
//（与 <img> 标签同一解码器，兼容性最好；iOS 上某些 webp 用 createImageBitmap 会失败），
// Image 失败再试 createImageBitmap。返回 null 表示彻底失败，调用方剔除该图。
export async function loadBitmap(url: string, timeoutMs = 30000): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let blob: Blob;
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`http ${r.status}`);
      blob = await r.blob();
    } finally {
      clearTimeout(timer);
    }
    if (!blob.size) throw new Error("empty body");
    const objUrl = URL.createObjectURL(blob);
    try {
      // 优先 Image：解码器与页面 <img> 一致
      try {
        const img = new Image();
        img.decoding = "async";
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("img error"));
          img.src = objUrl;
        });
        if (img.naturalWidth > 0 && img.naturalHeight > 0) return img;
      } catch {
        /* 继续尝试 createImageBitmap */
      }
      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(blob);
        if (bmp.width > 0 && bmp.height > 0) return bmp;
        try { bmp.close(); } catch { /* ignore */ }
      }
    } finally {
      URL.revokeObjectURL(objUrl);
    }
    return null;
  } catch {
    return null;
  }
}
